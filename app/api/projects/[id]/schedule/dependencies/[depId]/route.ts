import { requireUser, json, error } from "@/lib/api";

/**
 * Unlink two tasks.
 *
 * No cycle check needed: removing an edge can never create a loop. Dates on
 * both tasks are recomputed on the next read, because they were never stored.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; depId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("task_dependencies")
    .delete()
    .eq("id", params.depId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
