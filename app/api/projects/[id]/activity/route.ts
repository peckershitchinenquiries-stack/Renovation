import { requireUser, json, error } from "@/lib/api";
import { validateActivity, hasErrors } from "@/lib/validation";
import { buildActivityPayload } from "@/lib/contactWrite";
import type { ActivityInput } from "@/types";

/**
 * Record something that happened (migration 0022).
 *
 * There is deliberately no PATCH on this resource. The value of a log is
 * entirely in its being trustworthy, and a log that can be quietly rewritten
 * afterwards answers nothing six months later. A mistake is corrected by
 * deleting the entry and writing a new one, which at least leaves the
 * correction visible as a correction.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as ActivityInput;
  const errors = validateActivity(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const { data, error: dbError } = await auth.supabase
    .from("activity_log")
    .insert({
      ...buildActivityPayload(body),
      project_id: params.id,
      user_id: auth.user.id,
      // Two columns for the same person, on purpose: `user_id` is provenance
      // and cascades if the account is deleted (0015), `created_by` is
      // `on delete set null` so the entry survives somebody leaving.
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (dbError?.code === "42P01")
    return error(
      "The log tables are not installed — run 0022_activity_snags.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
