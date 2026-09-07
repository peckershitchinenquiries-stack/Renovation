import { requireUser, json, error } from "@/lib/api";
import { validateVariation, hasErrors } from "@/lib/validation";
import { buildVariationPayload } from "@/lib/contactWrite";
import type { VariationInput } from "@/types";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; variationId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as VariationInput;
  const errors = validateVariation(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const payload = buildVariationPayload(body);

  // Approving stamps who did it; anything else clears the stamp, so a
  // variation that is un-approved does not keep a name against a decision that
  // no longer stands. The pair moves together with `approved_on`, which
  // buildVariationPayload nulls for the same reason.
  const { data: existing } = await auth.supabase
    .from("variations")
    .select("approved_by, status")
    .eq("id", params.variationId)
    .eq("project_id", params.id)
    .single();
  if (!existing) return error("Variation not found", 404);

  const wasApproved =
    (existing as { status: string }).status === "approved";
  payload.approved_by =
    body.status === "approved"
      ? // Re-saving an already-approved variation must not reassign it to
        // whoever happened to edit the wording.
        (wasApproved && (existing as { approved_by: string | null }).approved_by) ||
        auth.user.id
      : null;

  const { data, error: dbError } = await auth.supabase
    .from("variations")
    .update(payload)
    .eq("id", params.variationId)
    .eq("project_id", params.id)
    .select()
    .single();

  if (dbError?.code === "23505")
    return error("That reference is already used on this project", 409, {
      ref: "Already used on this project",
    });
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Variation not found", 404);

  return json(data);
}

/**
 * Delete a variation.
 *
 * Nothing else depends on it — `task_id` and `phase_id` point outward, not in
 * — so this genuinely removes only the record of the change. Which is exactly
 * why the screen offers **withdrawn** as a status: a variation that was asked
 * for and then dropped is worth keeping, because the question will be asked
 * again.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; variationId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("variations")
    .delete()
    .eq("id", params.variationId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
