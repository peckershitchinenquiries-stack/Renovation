import { requireUser, json, error } from "@/lib/api";

/**
 * Put a day back to work (migration 0018).
 *
 * Deleting a holiday pulls every date after it earlier, so this is a write with
 * consequences well beyond the row it removes — the panel that calls it reloads
 * the whole schedule afterwards rather than just dropping the line.
 *
 * Scoped to the project as well as the id, like every other `schedule/*` delete:
 * RLS shares the whole workspace (about.md §9.1), so this route is the only
 * thing checking that the holiday being deleted belongs to the project in the
 * URL. A stale id from another project must 404, not delete.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; holidayId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("project_holidays")
    .delete()
    .eq("id", params.holidayId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
