import { requireUser, json, error } from "@/lib/api";
import { validateCertification, hasErrors } from "@/lib/validation";
import { buildCertificationPayload } from "@/lib/contactWrite";
import type { CertificationInput } from "@/types";

/** Record a certificate against a person (migration 0020). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as CertificationInput;
  const errors = validateCertification(
    body as unknown as Record<string, unknown>
  );
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // RLS shares everything, so this read is not an authorisation check — it is
  // what turns a bad id into a 404 instead of a foreign-key failure on insert.
  const { data: contact } = await auth.supabase
    .from("contacts")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!contact) return error("Contact not found", 404);

  const { data, error: dbError } = await auth.supabase
    .from("contact_certifications")
    .insert({
      ...buildCertificationPayload(body),
      contact_id: params.id,
      user_id: auth.user.id,
    })
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
