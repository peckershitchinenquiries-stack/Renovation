import { requireUser, json, error } from "@/lib/api";

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data, error: dbError } = await auth.supabase
    .from("trade_lookups")
    .select("*")
    .order("name", { ascending: true });
  if (dbError) return error(dbError.message, 500);
  return json(data);
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return error("Trade name is required", 422, { name: "Required" });

  const { data, error: dbError } = await auth.supabase
    .from("trade_lookups")
    .insert({
      user_id: auth.user.id,
      name,
      default_rate: Number(body.default_rate ?? 0),
      default_markup_pct: Number(body.default_markup_pct ?? 0),
    })
    .select()
    .single();
  if (dbError) {
    if (dbError.code === "23505")
      return error("A trade with that name already exists", 409);
    return error(dbError.message, 500);
  }
  return json(data, 201);
}
