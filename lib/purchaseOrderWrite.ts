/**
 * The purchase order write path (migration 0023).
 *
 * Modelled on lib/purchaseWrite.ts, and for the same reasons: the route
 * handlers stay thin, form strings are coerced to column types in exactly one
 * place, and lines are REPLACED rather than merged — `(po_id, line_no)` is
 * unique, so re-numbering in place would collide with itself, and an order is
 * small enough that rewriting it is simpler than diffing it.
 *
 * Route Handlers cannot open a transaction, so each write is followed by a
 * compensating clean-up if a later one fails: a failed create deletes the
 * order (its lines cascade), and a failed edit puts the original lines back.
 *
 * What is NOT here: any total. `purchase_orders` has no net, vat or gross
 * column, and `purchase_order_lines` has no `line_net`. Those are computed on
 * read in lib/purchaseOrders.ts, which is why a header can never disagree with
 * the lines it is made of.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupplierId } from "@/lib/purchaseWrite";
import type {
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLine,
} from "@/types";

type Client = SupabaseClient;

const text = (value: unknown): string | null => {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

const round = (value: unknown, places: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** places;
  return Math.round((n + Number.EPSILON) * factor) / factor;
};

function headerFields(input: PurchaseOrderInput) {
  return {
    po_number: text(input.po_number),
    // An order raised with no date is an order raised today. Unlike a purchase
    // date — which is a fact about a document that may be missing — this is a
    // fact about an action we just took, so there is nothing to be unsure of.
    raised_on: text(input.raised_on) ?? new Date().toISOString().slice(0, 10),
    expected_delivery: text(input.expected_delivery),
    status: input.status,
    task_id: text(input.task_id),
    notes: text(input.notes),
  };
}

function lineRows(input: PurchaseOrderInput, userId: string, poId: string) {
  return input.lines.map((line, i) => ({
    user_id: userId,
    po_id: poId,
    // Positional and starting at 1 — the order the items appear on the
    // document, exactly like purchase_lines.
    line_no: i + 1,
    item_id: text(line.item_id),
    description: String(line.description).trim(),
    qty_ordered: round(line.qty_ordered, 3),
    // Blank means nothing has arrived, which is what a new order says.
    qty_received: round(line.qty_received ?? 0, 3),
    unit: text(line.unit),
    unit_price: round(line.unit_price, 4),
    vat_rate: Number(line.vat_rate) || 0,
  }));
}

/**
 * Raise an order.
 *
 * The supplier is resolved through `resolveSupplierId`, the same function the
 * invoice form uses — so ordering from a merchant for the first time creates
 * the same supplier row the invoice will later match against, rather than a
 * near-duplicate that has to be merged by hand.
 */
export async function createPurchaseOrder(
  supabase: Client,
  userId: string,
  projectId: string,
  input: PurchaseOrderInput
): Promise<PurchaseOrder> {
  const supplierId = await resolveSupplierId(
    supabase,
    userId,
    input.supplier_name
  );

  const { data, error } = await supabase
    .from("purchase_orders")
    .insert({
      ...headerFields(input),
      user_id: userId,
      project_id: projectId,
      supplier_id: supplierId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  const order = data as PurchaseOrder;
  try {
    const { error: lineError } = await supabase
      .from("purchase_order_lines")
      .insert(lineRows(input, userId, order.id));
    if (lineError) throw new Error(lineError.message);
  } catch (e) {
    // An order with no lines holds nothing and explains nothing. Take it back
    // out — its lines cascade with it.
    await supabase.from("purchase_orders").delete().eq("id", order.id);
    throw e;
  }

  return order;
}

/** Replace an order's header and lines with what the form now says. */
export async function updatePurchaseOrder(
  supabase: Client,
  userId: string,
  projectId: string,
  poId: string,
  input: PurchaseOrderInput
): Promise<PurchaseOrder> {
  const supplierId = await resolveSupplierId(
    supabase,
    userId,
    input.supplier_name
  );

  const { data: oldLines } = await supabase
    .from("purchase_order_lines")
    .select("*")
    .eq("po_id", poId);

  const { data, error } = await supabase
    .from("purchase_orders")
    .update({ ...headerFields(input), supplier_id: supplierId })
    .eq("id", poId)
    // Scoped to the project as well as the id: this is what makes an order
    // from another job a 404 rather than an edit.
    .eq("project_id", projectId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  try {
    await supabase.from("purchase_order_lines").delete().eq("po_id", poId);
    const { error: lineError } = await supabase
      .from("purchase_order_lines")
      .insert(lineRows(input, userId, poId));
    if (lineError) throw new Error(lineError.message);
  } catch (e) {
    // Put the order back as it was, ids and all, rather than leave it empty.
    await supabase.from("purchase_order_lines").delete().eq("po_id", poId);
    if ((oldLines ?? []).length > 0)
      await supabase
        .from("purchase_order_lines")
        .insert(oldLines as PurchaseOrderLine[]);
    throw e;
  }

  return data as PurchaseOrder;
}

/**
 * Record what actually turned up.
 *
 * Kept apart from the full edit deliberately: marking a delivery is a thing
 * somebody does standing in a yard on a phone, and making them open the whole
 * order form — with its supplier, its prices and its VAT rates all editable —
 * to type one number is how a wrong price gets saved by accident.
 *
 * The status follows the quantities rather than being typed: an order whose
 * lines are all delivered IS received, and letting the two disagree makes the
 * status worthless.
 */
export async function recordReceipt(
  supabase: Client,
  poId: string,
  received: { line_id: string; qty_received: number | string }[]
): Promise<void> {
  for (const row of received) {
    const { error } = await supabase
      .from("purchase_order_lines")
      .update({ qty_received: round(row.qty_received, 3) })
      .eq("id", row.line_id)
      .eq("po_id", poId);
    if (error) throw new Error(error.message);
  }

  const { data: lines } = await supabase
    .from("purchase_order_lines")
    .select("qty_ordered, qty_received")
    .eq("po_id", poId);

  const rows = (lines ?? []) as { qty_ordered: number; qty_received: number }[];
  if (rows.length === 0) return;

  const all = rows.every(
    (l) => Number(l.qty_received) + 0.001 >= Number(l.qty_ordered)
  );
  const some = rows.some((l) => Number(l.qty_received) > 0);
  const status = all ? "received" : some ? "part_received" : "sent";

  const { error } = await supabase
    .from("purchase_orders")
    .update({ status })
    .eq("id", poId)
    // A cancelled order that receives a delivery stays cancelled — that is a
    // problem for a human, and quietly reviving it would hide it.
    .neq("status", "cancelled");
  if (error) throw new Error(error.message);
}
