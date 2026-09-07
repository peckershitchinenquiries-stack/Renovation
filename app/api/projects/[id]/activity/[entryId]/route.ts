import { requireUser, json, error } from "@/lib/api";

/**
 * Remove a log entry.
 *
 * The only write besides POST. There is no PATCH, for the reason given on the
 * create route: an editable log is not evidence. Deleting one is at least
 * visible as an absence, whereas silently rewording what somebody decided in
 * March is not.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; entryId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("activity_log")
    .delete()
    .eq("id", params.entryId)
    // Scoped to the project in the route as well as the id, so an entry from
    // another job is a no-op rather than a deletion.
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
