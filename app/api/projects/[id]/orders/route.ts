import { requireUser, json, error } from "@/lib/api";
import { validatePurchaseOrder, hasErrors } from "@/lib/validation";
import { createPurchaseOrder } from "@/lib/purchaseOrderWrite";
import type { PurchaseOrderInput } from "@/types";

/** Raise a purchase order (migration 0023). */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as PurchaseOrderInput;
  const errors = validatePurchaseOrder(
    body as unknown as Record<string, unknown>
  );
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  try {
    const order = await createPurchaseOrder(
      auth.supabase,
      auth.user.id,
      params.id,
      body
    );
    return json(order, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the order";
    // ux_purchase_orders_number: one order per number per project. Two orders
    // sharing a reference is the one thing that makes a PO list unusable.
    if (/duplicate key|23505/.test(message))
      return error("That PO number is already used on this project", 409, {
        po_number: "Already used on this project",
      });
    if (/does not exist|42P01/.test(message))
      return error(
        "The purchase order tables are not installed — run 0023_purchase_orders.sql",
        503
      );
    return error(message, 500);
  }
}
