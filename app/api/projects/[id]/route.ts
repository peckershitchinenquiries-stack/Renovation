import { requireUser, json, error } from "@/lib/api";
import { validateProject, hasErrors } from "@/lib/validation";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data, error: dbError } = await auth.supabase
    .from("projects")
    .select("*")
    .eq("id", params.id)
    .single();
  if (dbError || !data) return error("Project not found", 404);
  return json(data);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const errors = validateProject(body);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const fields = ["name", "target_budget", "status", "notes"] as const;
  const update: Record<string, unknown> = {};
  for (const f of fields) if (f in body) update[f] = body[f] === "" ? null : body[f];

  const { data, error: dbError } = await auth.supabase
    .from("projects")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (dbError || !data) return error(dbError?.message ?? "Project not found", 404);
  return json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  // expense_entries / project_weeks cascade via FK ON DELETE CASCADE.
  const { error: dbError } = await auth.supabase
    .from("projects")
    .delete()
    .eq("id", params.id);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
