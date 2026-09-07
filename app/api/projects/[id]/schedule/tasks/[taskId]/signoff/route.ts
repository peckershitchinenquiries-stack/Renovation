import { requireUser, json, error } from "@/lib/api";
import { validateSignoff, hasErrors } from "@/lib/validation";
import type { SignoffInput } from "@/types";

/**
 * Sign a stage off (migration 0020).
 *
 * ---------------------------------------------------------------------------
 * What this route does NOT do, and it matters
 * ---------------------------------------------------------------------------
 * There is no permission check here, and its absence is deliberate rather than
 * missing. This workspace has no roles: since 0015 every RLS policy is
 * `for all to authenticated`, and signing in is the entire authorisation model
 * (about.md §9.1). Anyone who can open the app can sign anything off — and can
 * also delete the whole project, which is the same trust decision.
 *
 * So what this route provides is the RECORD: who signed, when, with what
 * outcome, and what they said about it. That record is the valuable part and
 * it works without roles. Adding real ones means rewriting every policy in the
 * database, which should be its own decision rather than a side effect of
 * building this.
 *
 * Appended, never updated. A sign-off that can be edited afterwards is not a
 * sign-off; withdrawing one means recording a second, later outcome — which is
 * also what actually happens on site.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; taskId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as SignoffInput;
  const errors = validateSignoff(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // Proves the task belongs to the project in the route, which is what makes
  // a task id from another job a 404 rather than a cross-project sign-off.
  const { data: task } = await auth.supabase
    .from("tasks")
    .select("id")
    .eq("id", params.taskId)
    .eq("project_id", params.id)
    .single();
  if (!task) return error("Task not found", 404);

  const { data, error: dbError } = await auth.supabase
    .from("task_signoffs")
    .insert({
      user_id: auth.user.id,
      project_id: params.id,
      task_id: params.taskId,
      // The same person, recorded twice on purpose: `user_id` is provenance
      // and cascades if the account is deleted (0015), while `signed_by` is
      // `on delete set null` so the fact that the work WAS signed survives
      // somebody leaving.
      signed_by: auth.user.id,
      outcome: body.outcome,
      note: String(body.note ?? "").trim() || null,
    })
    .select()
    .single();

  if (dbError?.code === "42P01")
    return error("The people tables are not installed — run 0020_people.sql", 503);
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
