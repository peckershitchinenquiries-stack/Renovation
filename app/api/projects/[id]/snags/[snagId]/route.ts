import { requireUser, json, error } from "@/lib/api";
import { validateSnag, hasErrors } from "@/lib/validation";
import { buildSnagPayload } from "@/lib/contactWrite";
import type { SnagInput } from "@/types";

/**
 * Move a snag along — open → fixed → verified.
 *
 * Unlike the activity log, a snag is EDITABLE, and the difference is not an
 * inconsistency: a log entry records something that already happened and is
 * finished, whereas a snag is a live state that is supposed to change. The
 * dates are what make the state accountable, and `validateSnag` refuses a
 * status that its dates do not support — "verified" with nothing saying when
 * anybody looked at it is precisely the claim a snagging list exists to prove.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; snagId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as SnagInput;
  const errors = validateSnag(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const payload = buildSnagPayload(body);

  // Who checked it, stamped by the server rather than sent by the form —
  // "verified by" that the client can set is not verification. Cleared again
  // if a snag is reopened, so the name never outlives the claim.
  const verified = body.status === "verified";
  payload.verified_by = verified ? auth.user.id : null;

  const { data, error: dbError } = await auth.supabase
    .from("snags")
    .update(payload)
    .eq("id", params.snagId)
    .eq("project_id", params.id)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Snag not found", 404);

  return json(data);
}

/**
 * Delete a snag.
 *
 * Its photos survive: `documents.snag_id` is `on delete set null` (0022), so
 * the pictures stay in the document store and simply stop being about a snag.
 * Deleting a record must not delete evidence — the same rule that keeps
 * invoice lines alive when a task is deleted.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; snagId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("snags")
    .delete()
    .eq("id", params.snagId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
