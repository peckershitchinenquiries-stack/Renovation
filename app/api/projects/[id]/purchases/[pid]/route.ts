import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, json, error } from "@/lib/api";
import { validatePurchase, hasErrors } from "@/lib/validation";
import { updatePurchase } from "@/lib/purchaseWrite";
import type { PurchaseInput } from "@/types";

// Both handlers check the purchase belongs to the project in the URL before
// touching it, so a wrong id is a 404 rather than a silent edit of something
// else. RLS already restricts it to this user's rows.
async function findPurchase(
  supabase: SupabaseClient,
  projectId: string,
  purchaseId: string
) {
  const { data } = await supabase
    .from("purchases")
    .select("id, origin")
    .eq("id", purchaseId)
    .eq("project_id", projectId)
    .single();
  return data as { id: string; origin: string } | null;
}

// A backfilled purchase is the same money as an expense_entries row (migration
// 0008 copied it), and that row is what the Overview and Expenses tabs still
// read. Editing one side here would leave the two records of one purchase
// disagreeing, silently. Those rows stay editable through the Expenses tab
// until the switchover; this form owns what it created.
const LEGACY_MESSAGE =
  "This purchase was copied from the week-by-week sheet. Edit it in the project's Expenses tab instead, so the two records cannot drift apart.";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; pid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const errors = validatePurchase(body);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const existing = await findPurchase(auth.supabase, params.id, params.pid);
  if (!existing) return error("Purchase not found", 404);
  if (existing.origin === "legacy_import") return error(LEGACY_MESSAGE, 409);

  try {
    const purchase = await updatePurchase(
      auth.supabase,
      auth.user.id,
      params.pid,
      body as PurchaseInput
    );
    return json(purchase);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Could not save the invoice", 500);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; pid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const existing = await findPurchase(auth.supabase, params.id, params.pid);
  if (!existing) return error("Purchase not found", 404);
  if (existing.origin === "legacy_import") return error(LEGACY_MESSAGE, 409);

  // Lines, payments and receipts are all `on delete cascade` from the
  // purchase, so this removes the whole document (about.md §4.6).
  const { error: dbError } = await auth.supabase
    .from("purchases")
    .delete()
    .eq("id", params.pid);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
