import { requireUser, json, error } from "@/lib/api";
import { validatePurchaseOrder, hasErrors } from "@/lib/validation";
import { updatePurchaseOrder } from "@/lib/purchaseOrderWrite";
import type { PurchaseOrderInput } from "@/types";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; poId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as PurchaseOrderInput;
  const errors = validatePurchaseOrder(
    body as unknown as Record<string, unknown>
  );
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  try {
    const order = await updatePurchaseOrder(
      auth.supabase,
      auth.user.id,
      params.id,
      params.poId,
      body
    );
    return json(order);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the order";
    if (/duplicate key|23505/.test(message))
      return error("That PO number is already used on this project", 409, {
        po_number: "Already used on this project",
      });
    return error(message, 500);
  }
}

/**
 * Delete an order.
 *
 * Its lines cascade — a line means nothing apart from its order. Any INVOICE
 * matched to it does not: `purchases.purchase_order_id` is `on delete set null`
 * (0023), so the money survives and simply becomes unmatched. Deleting a
 * document you sent must never delete a bill you received.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; poId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { error: dbError } = await auth.supabase
    .from("purchase_orders")
    .delete()
    .eq("id", params.poId)
    .eq("project_id", params.id);
  if (dbError) return error(dbError.message, 500);

  return json({ ok: true });
}
