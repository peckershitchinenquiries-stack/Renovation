import { requireUser, json, error } from "@/lib/api";
import { validateExpense, hasErrors } from "@/lib/validation";
import { buildExpensePayload } from "@/lib/expense";
import { computeEntry } from "@/lib/calculations";
import type { ExpenseEntry } from "@/types";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data, error: dbError } = await auth.supabase
    .from("expense_entries")
    .select("*")
    .eq("id", params.eid)
    .eq("project_id", params.id)
    .single();
  if (dbError || !data) return error("Expense not found", 404);
  return json(computeEntry(data as ExpenseEntry));
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));

  // Support quick "Mark as Paid" partial updates without full re-validation.
  const isQuickUpdate =
    Object.keys(body).length <= 4 &&
    ("status" in body || "paid_date" in body) &&
    !("description" in body);

  let update: Record<string, unknown>;
  if (isQuickUpdate) {
    update = {};
    if ("status" in body) update.status = body.status;
    if ("paid_date" in body) update.paid_date = body.paid_date || null;
    if ("paid_amount" in body) update.paid_amount = Number(body.paid_amount ?? 0);
    if ("payment_method" in body) update.payment_method = body.payment_method || null;
  } else {
    const errors = validateExpense(body);
    if (hasErrors(errors)) return error("Validation failed", 422, errors);
    update = buildExpensePayload(body);
  }

  const { data, error: dbError } = await auth.supabase
    .from("expense_entries")
    .update(update)
    .eq("id", params.eid)
    .eq("project_id", params.id)
    .select()
    .single();
  if (dbError || !data) return error(dbError?.message ?? "Expense not found", 404);
  return json(computeEntry(data as ExpenseEntry));
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { error: dbError } = await auth.supabase
    .from("expense_entries")
    .delete()
    .eq("id", params.eid)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
