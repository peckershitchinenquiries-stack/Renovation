import { requireUser, json, error } from "@/lib/api";

// Upsert a week's manual completion % (Module 6 — week-by-week table input).
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const week_number = Number(body.week_number);
  const completion_pct = Number(body.completion_pct);
  if (!Number.isInteger(week_number) || week_number < 1)
    return error("Invalid week number", 422);
  if (completion_pct < 0 || completion_pct > 100)
    return error("Completion % must be 0–100", 422);

  const { data, error: dbError } = await auth.supabase
    .from("project_weeks")
    .upsert(
      {
        user_id: auth.user.id,
        project_id: params.id,
        week_number,
        completion_pct,
        notes: body.notes ?? null,
      },
      { onConflict: "project_id,week_number" }
    )
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  return json(data);
}
