import { requireUser, json, error } from "@/lib/api";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const update: Record<string, unknown> = {};
  if ("name" in body) update.name = String(body.name).trim();
  if ("default_rate" in body) update.default_rate = Number(body.default_rate);
  if ("default_markup_pct" in body)
    update.default_markup_pct = Number(body.default_markup_pct);

  const { data, error: dbError } = await auth.supabase
    .from("trade_lookups")
    .update(update)
    .eq("id", params.id)
    .select()
    .single();
  if (dbError || !data) return error(dbError?.message ?? "Trade not found", 404);
  return json(data);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // Block deletion if any expense entry references this trade by name.
  const { data: trade } = await auth.supabase
    .from("trade_lookups")
    .select("name")
    .eq("id", params.id)
    .single();
  if (!trade) return error("Trade not found", 404);

  const { count } = await auth.supabase
    .from("expense_entries")
    .select("id", { count: "exact", head: true })
    .eq("trade", trade.name);
  if ((count ?? 0) > 0)
    return error(
      "Cannot delete — expense entries still reference this trade",
      409
    );

  const { error: dbError } = await auth.supabase
    .from("trade_lookups")
    .delete()
    .eq("id", params.id);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
