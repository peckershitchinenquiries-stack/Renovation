import { requireUser, json, error } from "@/lib/api";
import { validateContact, hasErrors } from "@/lib/validation";
import { buildContactPayload } from "@/lib/contactWrite";
import type { ContactInput } from "@/types";

/**
 * Add somebody to the trades register (migration 0020).
 *
 * Cross-project, like suppliers and items: a person works on more than one
 * job, and a directory scoped to one project would need the same plasterer
 * entered twice.
 */
export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as ContactInput;
  const errors = validateContact(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data, error: dbError } = await auth.supabase
    .from("contacts")
    .insert({ ...buildContactPayload(body), user_id: auth.user.id })
    .select()
    .single();

  // 42P01: migration 0020 has not been pasted into the SQL editor yet. Saying
  // so beats a 500 that reads as a bug in the form.
  if (dbError?.code === "42P01")
    return error("The people tables are not installed — run 0020_people.sql", 503);
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
