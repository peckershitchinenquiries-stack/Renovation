import { requireUser, json, error } from "@/lib/api";
import { validateTask, hasErrors } from "@/lib/validation";
import { buildTaskPayload } from "@/lib/scheduleWrite";
import type { TaskInput } from "@/types";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as TaskInput;
  const errors = validateTask(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const payload = buildTaskPayload(body);

  // A new task goes at the end of its phase.
  if (String(body.sort_order ?? "").trim() === "") {
    const { data: last } = await auth.supabase
      .from("tasks")
      .select("sort_order")
      .eq("project_id", params.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    payload.sort_order =
      ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  }

  const { data, error: dbError } = await auth.supabase
    .from("tasks")
    .insert({ ...payload, project_id: params.id, user_id: auth.user.id })
    .select()
    .single();
  // Migrations here are pasted in by hand, so the schedule tables genuinely may
  // not exist. Saying which file to run beats a raw "relation does not exist",
  // which reads as a bug in the form rather than a step nobody has taken.
  if (dbError?.code === "42P01")
    return error(
      "The schedule tables are not installed — run 0016_schedule_core.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  // No revision row on create. A revision is a record of something CHANGING;
  // the task's own created_at is the record of it coming into existence, and a
  // log full of "planned_start: null → 2026-03-02" on every new task buries
  // the changes that matter.
  return json(data, 201);
}
