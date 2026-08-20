import { requireUser, json, error } from "@/lib/api";
import { validateExpense, hasErrors } from "@/lib/validation";
import { buildExpensePayload } from "@/lib/expense";
import { computeEntry } from "@/lib/calculations";
import {
  computePurchase,
  purchasesToSyntheticEntries,
  round2,
  SETTLED_TOLERANCE,
} from "@/lib/purchases";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { ExpenseEntry, Payment, Purchase } from "@/types";

type Auth = { user: User; supabase: SupabaseClient };

/**
 * The quick actions the Expenses list offers, applied to an invoice.
 *
 * Two things happen here, and the difference between them matters:
 *
 *   • `status` is the document's lifecycle flag (`entry_status`) — Planned,
 *     In Progress, Paid, Cancelled. It is a label, not money.
 *   • `paid_amount` is money, and an invoice does not have a paid column: what
 *     has been paid is the sum of its `payments` rows. So a request to set it
 *     is turned into a payment for the DIFFERENCE between what the caller says
 *     is now paid and what the payment rows already add up to.
 *
 * That difference is the whole reason this cannot be a column update. Pressing
 * "Mark Paid" twice must not pay the invoice twice, and it does not: the second
 * press computes a delta of zero and writes nothing.
 */
async function patchInvoice(
  auth: Auth,
  projectId: string,
  purchaseId: string,
  body: Record<string, unknown>
) {
  const { data: existing } = await auth.supabase
    .from("purchases")
    .select("*")
    .eq("id", purchaseId)
    .eq("project_id", projectId)
    .single();
  if (!existing) return error("Invoice not found", 404);
  const purchase = existing as Purchase;

  if ("status" in body) {
    const { error: statusError } = await auth.supabase
      .from("purchases")
      .update({ entry_status: body.status })
      .eq("id", purchaseId);
    if (statusError) return error(statusError.message, 500);
  }

  const readPayments = async (): Promise<Payment[]> => {
    const { data } = await auth.supabase
      .from("payments")
      .select("*")
      .eq("purchase_id", purchaseId);
    return (data ?? []) as Payment[];
  };

  if ("paid_amount" in body) {
    const alreadyPaid = (await readPayments()).reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const target = Number(body.paid_amount ?? 0);
    const delta = round2(target - alreadyPaid);

    if (delta > SETTLED_TOLERANCE) {
      const { error: payError } = await auth.supabase.from("payments").insert({
        user_id: auth.user.id,
        purchase_id: purchaseId,
        paid_on:
          (body.paid_date as string | null) ||
          new Date().toISOString().slice(0, 10),
        amount: delta,
        method: (body.payment_method as string | null) || null,
        reference: purchase.invoice_no,
      });
      if (payError) return error(payError.message, 500);
    } else if (delta < -SETTLED_TOLERANCE) {
      // Paying less than has already been paid is not an edit, it is a refund
      // or a correction to a specific payment. Both belong on the invoice
      // form, where you can see which payment you are changing.
      return error(
        "This invoice already has more paid against it than that. Remove or correct the payment on the invoice itself.",
        409
      );
    }
  }

  // Reply in the same shape the list sent: the invoice as a synthetic entry,
  // supplier name included so its description reads the same as it did before.
  const [{ data: updated }, { data: supplier }] = await Promise.all([
    auth.supabase.from("purchases").select("*").eq("id", purchaseId).single(),
    purchase.supplier_id
      ? auth.supabase
          .from("suppliers")
          .select("id, name")
          .eq("id", purchase.supplier_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const named = supplier as { id: string; name: string } | null;
  const [entry] = purchasesToSyntheticEntries(
    [computePurchase((updated ?? purchase) as Purchase, await readPayments())],
    named ? new Map([[named.id, named.name]]) : new Map()
  );
  return json(entry);
}

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

  // An `inv:` id is not an expense row at all — it is a purchase, rendered in
  // the Expenses list so the two records read as one diary. What can be done to
  // it from here is deliberately narrow: its status, and recording a payment.
  // Everything else about an invoice (its supplier, its lines, its VAT) is a
  // property of the document and is edited on the invoice form, which is the
  // only screen that can keep the header and its lines in agreement.
  if (params.eid.startsWith("inv:")) {
    if (!isQuickUpdate)
      return error(
        "Invoices are edited on the invoice form, not the expense form — open the invoice to change its supplier, lines or amounts.",
        409
      );
    return patchInvoice(auth, params.id, params.eid.slice(4), body);
  }

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

  if (params.eid.startsWith("inv:")) {
    const purchaseId = params.eid.slice(4);
    const { error: dbError } = await auth.supabase
      .from("purchases")
      .delete()
      .eq("id", purchaseId)
      .eq("project_id", params.id);
    if (dbError) return error(dbError.message, 500);
    return json({ ok: true });
  }

  const { error: dbError } = await auth.supabase
    .from("expense_entries")
    .delete()
    .eq("id", params.eid)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
