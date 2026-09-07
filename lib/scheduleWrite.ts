/**
 * The schedule's write path.
 *
 * Modelled on `lib/purchaseWrite.ts`: the route handlers stay thin, the
 * coercion from form strings to column types happens once, and the client and
 * the server therefore agree on what a blank field means.
 *
 * ---------------------------------------------------------------------------
 * One rule, and it is the whole reason this file exists
 * ---------------------------------------------------------------------------
 * **Every write that moves a task goes through `recordRevisions`.** A date
 * cannot move without a log row. That is not a convention to be remembered at
 * each call site — `applyTaskUpdate` below is the only supported way to change
 * a task, and it writes the log itself.
 *
 * Phase 3's auto-shift calls the same helper with `shift_source: 'knock_on'`,
 * carrying the reason from the task the person actually edited. That is what
 * makes the log worth reading later: it says "this slipped because the steels
 * were late", not "this slipped".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReasonCode, ShiftSource, Task, TaskInput } from "@/types";

/**
 * The fields worth logging.
 *
 * Not every column: nobody needs a revision row because a note was reworded.
 * These six are the ones that change what the schedule and the budget SAY.
 */
export const REVISION_FIELDS = [
  "planned_start",
  "planned_end",
  "duration_days",
  "budget_amount",
  "status",
  "progress_pct",
] as const;

export type RevisionField = (typeof REVISION_FIELDS)[number];

/** The three that move a bar, and therefore demand a reason once baselined. */
export const DATE_FIELDS: RevisionField[] = [
  "planned_start",
  "planned_end",
  "duration_days",
];

export interface FieldChange {
  field: RevisionField;
  old_value: string | null;
  new_value: string | null;
}

// A blank string from a form is "cleared", not "zero" and not "unchanged" —
// the same distinction validatePurchase makes about a blank VAT rate.
const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const numberOrNull = (v: unknown): number | null => {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v: unknown): number | null => {
  const n = numberOrNull(v);
  return n === null ? null : Math.round(n);
};

/**
 * Form fields → column values, once.
 *
 * Note what is NOT here: `computed_start`, `total_float`, `is_critical` and
 * every other scheduled figure. Those are derived on read by lib/schedule.ts
 * and there is no column to write them to (about.md §2).
 */
export function buildTaskPayload(body: TaskInput): Record<string, unknown> {
  return {
    phase_id: text(body.phase_id),
    name: String(body.name ?? "").trim(),
    trade: text(body.trade),
    // Migration 0020 gave this column its foreign key to `contacts`. Blank
    // means nobody is assigned, which is a legitimate state — and because the
    // FK is `on delete set null`, removing somebody from the register can only
    // ever blank this, never delete the task.
    assignee_contact_id: text(body.assignee_contact_id),
    planned_start: text(body.planned_start),
    planned_end: text(body.planned_end),
    actual_start: text(body.actual_start),
    actual_end: text(body.actual_end),
    duration_days: intOrNull(body.duration_days),
    progress_pct: numberOrNull(body.progress_pct) ?? 0,
    status: body.status,
    budget_amount: numberOrNull(body.budget_amount),
    weather_sensitive: Boolean(body.weather_sensitive),
    lead_time_days: intOrNull(body.lead_time_days),
    hire_daily_rate: numberOrNull(body.hire_daily_rate),
    notes: text(body.notes),
    sort_order: intOrNull(body.sort_order) ?? 0,
  };
}

/** Stringify a value for the log. `null` stays null so "cleared" is visible. */
function logValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * What actually changed, restricted to the six fields worth logging.
 *
 * Compared as strings on purpose. Postgres hands `numeric` back as a string,
 * `date` as 'YYYY-MM-DD', and a form sends everything as text — comparing the
 * raw values would report a change every time a budget of 1200 came back as
 * "1200.00".
 */
export function diffTaskFields(
  before: Task,
  after: Record<string, unknown>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of REVISION_FIELDS) {
    if (!(field in after)) continue;
    const oldValue = logValue((before as unknown as Record<string, unknown>)[field]);
    const newValue = logValue(after[field]);
    // Numbers, compared numerically: "1200" and "1200.00" are the same budget.
    if (oldValue !== null && newValue !== null) {
      const a = Number(oldValue);
      const b = Number(newValue);
      if (Number.isFinite(a) && Number.isFinite(b) && a === b) continue;
    }
    if (oldValue === newValue) continue;
    changes.push({ field, old_value: oldValue, new_value: newValue });
  }
  return changes;
}

/** Does this set of changes move a bar? Drives the "why did it move?" prompt. */
export function movesDates(changes: FieldChange[]): boolean {
  return changes.some((c) => DATE_FIELDS.includes(c.field));
}

export interface RevisionContext {
  userId: string;
  projectId: string;
  taskId: string;
  reason_code?: ReasonCode | "" | null;
  reason_note?: string | null;
  shift_source?: ShiftSource;
  changedBy?: string | null;
}

/**
 * Write one log row per changed field.
 *
 * Deliberately not batched into a single row with a JSON blob: "the budget
 * moved" and "the date moved" are two different questions and the history
 * screen filters on the field. A failure here is logged and swallowed — losing
 * the audit trail is bad, but refusing to save the user's work because the
 * audit trail failed is worse, and the row they were saving is already written
 * by the time this runs.
 */
export async function recordRevisions(
  supabase: SupabaseClient,
  ctx: RevisionContext,
  changes: FieldChange[]
): Promise<void> {
  if (changes.length === 0) return;
  const rows = changes.map((change) => ({
    user_id: ctx.userId,
    project_id: ctx.projectId,
    task_id: ctx.taskId,
    changed_by: ctx.changedBy ?? ctx.userId,
    field: change.field,
    old_value: change.old_value,
    new_value: change.new_value,
    reason_code: text(ctx.reason_code) as ReasonCode | null,
    reason_note: text(ctx.reason_note),
    shift_source: ctx.shift_source ?? "manual",
  }));

  const { error } = await supabase.from("task_revisions").insert(rows);
  if (error)
    console.error("[schedule] revision log failed:", error.message, ctx.taskId);
}

/**
 * Update a task AND log what moved. The only supported way to change one.
 *
 * Returns the saved row, or an error message. The read-before-write is what
 * makes the log possible at all — there is no other way to know what the old
 * value was — and it also proves the task belongs to the project in the route,
 * which is a check the route would otherwise have to make separately.
 */
export async function applyTaskUpdate(
  supabase: SupabaseClient,
  args: {
    userId: string;
    projectId: string;
    taskId: string;
    patch: Record<string, unknown>;
    reason_code?: ReasonCode | "" | null;
    reason_note?: string | null;
    shift_source?: ShiftSource;
  }
): Promise<{ task: Task } | { error: string; status: number }> {
  const { data: before } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", args.taskId)
    .eq("project_id", args.projectId)
    .single();
  if (!before) return { error: "Task not found", status: 404 };

  const changes = diffTaskFields(before as Task, args.patch);

  const { data, error } = await supabase
    .from("tasks")
    .update(args.patch)
    .eq("id", args.taskId)
    .eq("project_id", args.projectId)
    .select()
    .single();
  if (error) return { error: error.message, status: 500 };

  await recordRevisions(
    supabase,
    {
      userId: args.userId,
      projectId: args.projectId,
      taskId: args.taskId,
      reason_code: args.reason_code,
      reason_note: args.reason_note,
      shift_source: args.shift_source,
    },
    changes
  );

  return { task: data as Task };
}
