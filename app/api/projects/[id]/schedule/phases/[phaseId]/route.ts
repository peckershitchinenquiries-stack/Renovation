import { requireUser, json, error } from "@/lib/api";
import { validatePhase, hasErrors } from "@/lib/validation";
import type { PhaseInput } from "@/types";

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; phaseId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as PhaseInput;
  const errors = validatePhase(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const patch: Record<string, unknown> = {
    name: String(body.name).trim(),
    colour: text(body.colour),
    target_start: text(body.target_start),
    target_end: text(body.target_end),
    notes: text(body.notes),
  };
  if (body.sort_order !== undefined && String(body.sort_order).trim() !== "")
    patch.sort_order = Math.round(Number(body.sort_order));

  const { data, error: dbError } = await auth.supabase
    .from("project_phases")
    .update(patch)
    // Scoped to the project as well as the id: a phase id from another project
    // must 404, not update. RLS shares everything, so the route is the only
    // thing checking the two ids belong together.
    .eq("id", params.phaseId)
    .eq("project_id", params.id)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Phase not found", 404);

  return json(data);
}

/**
 * Delete a phase. Its tasks survive.
 *
 * `tasks.phase_id` is `on delete set null` (migration 0016), so the work
 * reappears in the Unphased group rather than being destroyed alongside the
 * heading it happened to be filed under. That is deliberate and it is why this
 * route needs no warning about losing tasks.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; phaseId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("project_phases")
    .delete()
    .eq("id", params.phaseId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
