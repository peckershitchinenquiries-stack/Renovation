import { requireUser, json, error } from "@/lib/api";
import {
  validateTask,
  validateShiftReason,
  hasErrors,
} from "@/lib/validation";
import {
  applyTaskUpdate,
  buildTaskPayload,
  diffTaskFields,
  movesDates,
} from "@/lib/scheduleWrite";
import type { Task, TaskInput } from "@/types";

/**
 * Edit one task, and log what moved.
 *
 * The interesting part is the reason gate. If this edit moves a date and the
 * task has a baseline to move away from, a reason code is REQUIRED — a 422 on
 * `reason_code`, which the form renders under the field like any other
 * validation error. The check happens after the diff, so changing a note on a
 * baselined task is not interrogated, and moving a date on a task nobody has
 * baselined yet is not either: there is nothing to explain until there is
 * something to explain it against.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as TaskInput;
  const errors = validateTask(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: before } = await auth.supabase
    .from("tasks")
    .select("*")
    .eq("id", params.taskId)
    .eq("project_id", params.id)
    .single();
  if (!before) return error("Task not found", 404);

  const payload = buildTaskPayload(body);
  const changes = diffTaskFields(before as Task, payload);

  const { count } = await auth.supabase
    .from("task_baselines")
    .select("id", { count: "exact", head: true })
    .eq("task_id", params.taskId);

  const reasonErrors = validateShiftReason(
    body as unknown as Record<string, unknown>,
    { movesDates: movesDates(changes), hasBaseline: (count ?? 0) > 0 }
  );
  if (hasErrors(reasonErrors))
    return error("This moves a baselined date — say why", 422, reasonErrors);

  const result = await applyTaskUpdate(auth.supabase, {
    userId: auth.user.id,
    projectId: params.id,
    taskId: params.taskId,
    patch: payload,
    reason_code: body.reason_code,
    reason_note: body.reason_note,
    shift_source: "manual",
  });
  if ("error" in result) return error(result.error, result.status);

  return json(result.task);
}

/**
 * Delete a task.
 *
 * Its dependencies go with it (`on delete cascade`) and its revisions and
 * baselines go with it, because all three are *about* this task and mean
 * nothing without it. Its MONEY does not: `purchase_lines.task_id` and
 * `expense_entries.task_id` are `on delete set null` (migration 0017), so
 * tagged invoice lines survive and reappear in the untagged bucket. Deleting a
 * task must never delete money.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("tasks")
    .delete()
    .eq("id", params.taskId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
