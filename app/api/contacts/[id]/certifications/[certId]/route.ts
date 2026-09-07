import { requireUser, json, error } from "@/lib/api";
import { validateCertification, hasErrors } from "@/lib/validation";
import { buildCertificationPayload } from "@/lib/contactWrite";
import type { CertificationInput } from "@/types";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; certId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as CertificationInput;
  const errors = validateCertification(
    body as unknown as Record<string, unknown>
  );
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data, error: dbError } = await auth.supabase
    .from("contact_certifications")
    .update(buildCertificationPayload(body))
    .eq("id", params.certId)
    // Scoped to the contact in the route as well as the id: a certificate id
    // from somebody else's record is a 404, not an edit.
    .eq("contact_id", params.id)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Certificate not found", 404);

  return json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; certId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("contact_certifications")
    .delete()
    .eq("id", params.certId)
    .eq("contact_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
