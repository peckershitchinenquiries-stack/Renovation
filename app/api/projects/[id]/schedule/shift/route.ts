import { requireUser, json, error } from "@/lib/api";
import { getScheduleBundle } from "@/lib/data";
import { applyShift, calendarDaysBetween, isISODate } from "@/lib/schedule";
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

  const duration =
    String(body.duration_days ?? "").trim() === ""
      ? undefined
      : Math.round(Number(body.duration_days));

  const { before, after, changes } = applyShift(bundle, body.task_id, {
    planned_start: body.planned_start ?? null,
    planned_end: body.planned_end ?? null,
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
    cycle: null,
  };

  if (!body.confirm) return json(preview);

  // ---- from here down, we are saving ----

  const { count } = await auth.supabase
    .from("task_baselines")
    .select("id", { count: "exact", head: true })
    .eq("task_id", body.task_id);

  const reasonErrors = validateShiftReason(
    body as unknown as Record<string, unknown>,
    { movesDates: rows.length > 0, hasBaseline: (count ?? 0) > 0 }
  );
  if (hasErrors(reasonErrors))
    return error("This moves a baselined date — say why", 422, reasonErrors);

  const afterById = new Map(after.tasks.map((t) => [t.id, t]));

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

    const { error: dbError } = await auth.supabase
      .from("tasks")
      .update(patch)
      .eq("id", row.task_id)
      .eq("project_id", params.id);
    if (dbError) return error(dbError.message, 500);

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
  }

  return json({ ...preview, saved: true });
}
