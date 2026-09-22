import { requireUser, json, error } from "@/lib/api";
import { validatePhase, hasErrors } from "@/lib/validation";
import type { PhaseInput } from "@/types";

const text = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as PhaseInput;
  const errors = validatePhase(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  // A new phase goes at the end. Read the current maximum rather than counting
  // rows: phases get deleted, and a count would collide with an existing order.
  let sort_order = Number(body.sort_order ?? NaN);
  if (!Number.isFinite(sort_order)) {
    const { data: last } = await auth.supabase
      .from("project_phases")
      .select("sort_order")
      .eq("project_id", params.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    sort_order = ((last as { sort_order: number } | null)?.sort_order ?? -1) + 1;
  }

  const { data, error: dbError } = await auth.supabase
    .from("project_phases")
    .insert({
      user_id: auth.user.id,
      project_id: params.id,
      name: String(body.name).trim(),
      sort_order,
      colour: text(body.colour),
      target_start: text(body.target_start),
      target_end: text(body.target_end),
      notes: text(body.notes),
    })
    .select()
    .single();
  // Migrations here are pasted in by hand, so the schedule tables genuinely may
  // not exist yet. Naming the file to run beats a raw "relation does not
  // exist", which reads as a bug in the form.
  if (dbError?.code === "42P01")
    return error(
      "The schedule tables are not installed — run 0016_schedule_core.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  return json(data, 201);
}
