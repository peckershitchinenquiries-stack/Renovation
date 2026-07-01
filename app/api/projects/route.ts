import { requireUser, json, error } from "@/lib/api";
import { validateProject, hasErrors } from "@/lib/validation";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data, error: dbError } = await auth.supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (dbError) return error(dbError.message, 500);
  return json(data);
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const errors = validateProject(body);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const insert = {
    user_id: auth.user.id,
    name: String(body.name).trim(),
    target_budget: Number(body.target_budget ?? 0),
    status: body.status ?? "active",
    notes: body.notes ?? null,
  };

  const { data, error: dbError } = await auth.supabase
    .from("projects")
    .insert(insert)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  return json(data, 201);
}
