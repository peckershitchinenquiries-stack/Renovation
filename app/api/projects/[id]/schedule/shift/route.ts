import { requireUser, json, error } from "@/lib/api";
import { getScheduleBundle } from "@/lib/data";
import {
  applyShift,
  calendarDaysBetween,
  durationFromDates,
  isISODate,
} from "@/lib/schedule";
import { costImpactOfShift } from "@/lib/scheduleCosts";
import { recordRevisions, type FieldChange } from "@/lib/scheduleWrite";
import { validateShiftReason, hasErrors } from "@/lib/validation";
import type {
  ShiftPreview,
  ShiftPreviewRow,
  ShiftRequest,
  Task,
  TradeLookup,
} from "@/types";

/**
 * Move a task, and everything that follows it.
 *
 * The spec asks for the knock-on effect. The dangerous version of that
 * silently rewrites twenty rows and tells you afterwards. This is the safe one:
 *
 *   1. The user changes a date.
 *   2. This route computes the consequence IN MEMORY and returns it —
 *      "this moves 6 tasks; completion goes 27 Nov → 4 Dec" — writing nothing.
 *   3. Nothing is saved until the same request comes back with
 *      `confirm: true`.
 *   4. On confirm, the moved tasks are written AND a task_revisions row is
 *      written per task, the downstream ones marked `knock_on` and carrying the
 *      originating task's reason.
 *
 * **The same request shape is used both times.** That symmetry is worth more
 * than the round trip it costs: a preview computed by different code from the
 * save is a preview that can disagree with what actually happens, and this is
 * exactly the feature where nobody would notice for weeks.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as ShiftRequest;
  if (!body.task_id) return error("Which task?", 422, { task_id: "Required" });

  const bundle = await getScheduleBundle(params.id);
  if (!bundle) return error("Project not found", 404);

  const target = bundle.tasks.find((t) => t.id === body.task_id);
  if (!target) return error("Task not found", 404);

  // Dates are checked here rather than left to the CHECK constraints, because
  // everything below derives from them — a reversed pair would otherwise become
  // a silently ignored duration rather than a message under the field.
  const start = body.planned_start ?? null;
  const end = body.planned_end ?? null;
  if (start !== null && !isISODate(start))
    return error("Use a real date", 422, { planned_start: "Use a real date" });
  if (end !== null && !isISODate(end))
    return error("Use a real date", 422, { planned_end: "Use a real date" });
  if (isISODate(start) && isISODate(end) && end < start)
    return error("The end cannot be before the start", 422, {
      planned_end: "The end cannot be before the start",
    });

  /**
   * How long the task now is.
   *
   * `duration_days` is authoritative (rule 1 of lib/schedule.ts), so a new END
   * date has to be converted into one or the engine ignores it outright: the
   * preview would report "no change" and the confirm would then write the
   * duration-derived end back over what the user typed. That was the bug. An
   * explicit `duration_days` in the request still wins — the task form sends
   * one — and a move with no end date leaves the duration alone.
   */
  const explicit =
    String(body.duration_days ?? "").trim() === ""
      ? undefined
      : Math.round(Number(body.duration_days));
  const duration =
    explicit ?? durationFromDates(start, end, bundle.calendar);

  const { before, after, changes } = applyShift(bundle, body.task_id, {
    planned_start: start,
    planned_end: end,
    ...(duration !== undefined ? { duration_days: duration } : {}),
  });

  if (after.cycle)
    return error(
      "The schedule contains a dependency loop — fix it before moving anything",
      400,
      { cycle: after.cycle }
    );

  const beforeCompletion = before.completion;

  const rows: ShiftPreviewRow[] = changes.map((c) => ({
    task_id: c.task_id,
    task_name:
      bundle.tasks.find((t) => t.id === c.task_id)?.name ?? "Unknown task",
    from_start: c.from_start,
    to_start: c.to_start,
    from_end: c.from_end,
    to_end: c.to_end,
    days: c.days,
    knock_on: c.knock_on,
  }));

  // How much longer the edited task got, which is what a hire and a waiting
  // trade are actually charged for. A task that MOVED without getting longer
  // costs nothing extra in these terms, and saying so is more honest than
  // pricing the move.
  const editedRow = changes.find((c) => !c.knock_on);
  const extraDays =
    editedRow &&
    isISODate(editedRow.from_start) &&
    isISODate(editedRow.to_start) &&
    isISODate(editedRow.from_end) &&
    isISODate(editedRow.to_end)
      ? Math.max(
          0,
          calendarDaysBetween(editedRow.from_end, editedRow.to_end) -
            calendarDaysBetween(editedRow.from_start, editedRow.to_start)
        )
      : 0;

  const { data: trades } = await auth.supabase.from("trade_lookups").select("*");

  /**
   * Is a reason compulsory?
   *
   * Every task this move TOUCHES is considered, not just the one the user
   * edited. Moving an unbaselined task that knocks on six baselined ones moves
   * six baselined dates, and a revision log that stayed silent about those six
   * is exactly the log nobody can answer a question from later.
   *
   * Read from the bundle's CURRENT baseline — the set drift is measured
   * against — rather than counting any baseline ever captured, so the rule and
   * the Drift column agree about what is baselined.
   */
  const baselinedIds = new Set(bundle.baseline.map((b) => b.task_id));
  const needsReason = rows.some((r) => baselinedIds.has(r.task_id));

  const preview: ShiftPreview = {
    rows,
    completion_before: beforeCompletion,
    completion_after: after.completion,
    completion_days:
      isISODate(beforeCompletion) && isISODate(after.completion)
        ? calendarDaysBetween(beforeCompletion, after.completion)
        : 0,
    cost_impact: costImpactOfShift(
      target,
      extraDays,
      (trades ?? []) as TradeLookup[]
    ),
    needs_reason: needsReason,
    cycle: null,
  };

  if (!body.confirm) return json(preview);

  // ---- from here down, we are saving ----

  const reasonErrors = validateShiftReason(
    body as unknown as Record<string, unknown>,
    { movesDates: rows.length > 0, hasBaseline: needsReason }
  );
  if (hasErrors(reasonErrors))
    return error("This moves a baselined date — say why", 422, reasonErrors);

  const afterById = new Map(after.tasks.map((t) => [t.id, t]));

  /**
   * What to put back if this goes wrong half way through.
   *
   * A Route Handler cannot open a transaction, so a multi-row write needs the
   * compensating clean-up `lib/purchaseOrderWrite.ts` already uses: remember
   * each task's stored dates BEFORE touching it, and on a failure write them
   * all back. A shift that half-applied is worse than one that did not apply —
   * it leaves a schedule nobody chose and no message saying which half landed.
   */
  const undo: { id: string; patch: Record<string, unknown> }[] = [];
  /** Revisions to log once — and only if — every row has been written. */
  const pending: { row: ShiftPreviewRow; fieldChanges: FieldChange[] }[] = [];
  const rollback = async () => {
    for (const step of undo.reverse())
      await auth.supabase
        .from("tasks")
        .update(step.patch)
        .eq("id", step.id)
        .eq("project_id", params.id);
  };

  for (const row of rows) {
    const scheduled = afterById.get(row.task_id);
    if (!scheduled) continue;
    const stored = bundle.tasks.find((t) => t.id === row.task_id) as Task;

    // The computed start is written back as `planned_start`, which pins it —
    // rule 2 of lib/schedule.ts, "start no earlier than". Without that, the
    // next recompute would pull a knocked-on task straight back to where its
    // constraints allow, and the confirmed shift would silently undo itself.
    const patch: Record<string, unknown> = {
      planned_start: scheduled.computed_start,
      planned_end: scheduled.computed_end,
    };
    if (!row.knock_on && duration !== undefined) patch.duration_days = duration;

    undo.push({
      id: row.task_id,
      patch: {
        planned_start: stored?.planned_start ?? null,
        planned_end: stored?.planned_end ?? null,
        ...(patch.duration_days !== undefined
          ? { duration_days: stored?.duration_days ?? null }
          : {}),
      },
    });

    const { error: dbError } = await auth.supabase
      .from("tasks")
      .update(patch)
      .eq("id", row.task_id)
      .eq("project_id", params.id);
    if (dbError) {
      await rollback();
      return error(
        `${dbError.message} — nothing was saved, the schedule is as it was`,
        500
      );
    }

    const fieldChanges: FieldChange[] = [];
    if (row.from_start !== row.to_start)
      fieldChanges.push({
        field: "planned_start",
        old_value: row.from_start,
        new_value: row.to_start,
      });
    if (row.from_end !== row.to_end)
      fieldChanges.push({
        field: "planned_end",
        old_value: row.from_end,
        new_value: row.to_end,
      });
    if (!row.knock_on && duration !== undefined && stored?.duration_days !== duration)
      fieldChanges.push({
        field: "duration_days",
        old_value: stored?.duration_days == null ? null : String(stored.duration_days),
        new_value: String(duration),
      });

    pending.push({ row, fieldChanges });
  }

  // The log is written only once every row is safely saved. Writing it inside
  // the loop would leave revisions describing moves that a rollback has since
  // undone — a log that says a task moved when it did not is worse than no log.
  for (const { row, fieldChanges } of pending)
    await recordRevisions(
      auth.supabase,
      {
        userId: auth.user.id,
        projectId: params.id,
        taskId: row.task_id,
        // Every knocked-on task carries the SAME reason as the task that
        // caused it. This is the whole value of the log: six months on it says
        // "this slipped because the steels were late", not "this slipped".
        reason_code: body.reason_code,
        reason_note: body.reason_note,
        shift_source: row.knock_on ? "knock_on" : "manual",
      },
      fieldChanges
    );

  return json({ ...preview, saved: true });
}
