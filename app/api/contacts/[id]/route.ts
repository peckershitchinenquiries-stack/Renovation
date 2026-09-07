import { requireUser, json, error } from "@/lib/api";
import { validateContact, hasErrors } from "@/lib/validation";
import { buildContactPayload } from "@/lib/contactWrite";
import type { ContactInput } from "@/types";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as ContactInput;
  const errors = validateContact(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data, error: dbError } = await auth.supabase
    .from("contacts")
    .update(buildContactPayload(body))
    .eq("id", params.id)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Contact not found", 404);

  return json(data);
}

/**
 * Remove somebody from the register.
 *
 * Their certificates go with them (`on delete cascade`) — a certificate is
 * *about* a person and means nothing without one. Everything else survives:
 * `tasks.assignee_contact_id`, `snags.contact_id`, `activity_log.contact_id`
 * and `documents.contact_id` are all `on delete set null`, so the work, the
 * snags and the record of the phone call remain. Deleting a person must never
 * delete the job.
 *
 * Which is also why the screen offers **inactive** first: somebody who has
 * finished on this job but might come back should be marked inactive, not
 * deleted, so their history keeps their name on it.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("contacts")
    .delete()
    .eq("id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
