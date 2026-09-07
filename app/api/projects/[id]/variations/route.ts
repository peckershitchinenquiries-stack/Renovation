import { requireUser, json, error } from "@/lib/api";
import { validateVariation, hasErrors } from "@/lib/validation";
import { buildVariationPayload } from "@/lib/contactWrite";
import type { VariationInput } from "@/types";

/** Raise a change order (migration 0024). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as VariationInput;
  const errors = validateVariation(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  const payload = buildVariationPayload(body);
  // Stamped by the server, never sent by the form: an approver the client can
  // choose is not an approval. Only set while the variation actually is
  // approved, so the name cannot outlive the decision.
  payload.approved_by = body.status === "approved" ? auth.user.id : null;

  const { data, error: dbError } = await auth.supabase
    .from("variations")
    .insert({ ...payload, project_id: params.id, user_id: auth.user.id })
    .select()
    .single();

  if (dbError?.code === "23505")
    return error("That reference is already used on this project", 409, {
      ref: "Already used on this project",
    });
  if (dbError?.code === "42P01")
    return error(
      "The variations table is not installed — run 0024_variations.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
