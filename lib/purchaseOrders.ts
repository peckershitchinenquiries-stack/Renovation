/**
 * Purchase orders — what was ordered, what arrived, and what it was invoiced
 * at.
 *
 * Everything below is derived on read. `purchase_orders` has no totals column
 * and `purchase_order_lines` has no `line_net`, deliberately: qty × unit price
 * is arithmetic, not data, and storing it is how a header comes to disagree
 * with the lines it is made of (about.md §2).
 *
 * ---------------------------------------------------------------------------
 * A PO is not spend
 * ---------------------------------------------------------------------------
 * Nothing in this file feeds Committed, Cost, Paid or Owed. An order is an
 * intention; only the invoice that follows is money. That separation is the
 * whole reason `purchase_orders` is its own table rather than a status on
 * `purchases`, and any screen that adds a PO total to a spend total is wrong.
 *
 * The number worth having is `price_variance`: what the invoices actually came
 * to, against what the order said. That is where price creep on a trade
 * account shows up, and it is the only reason to type an order in at all.
 */

import { round2 } from "@/lib/purchases";
import type {
  Purchase,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderLineView,
  PurchaseOrderView,
  PurchaseLine,
} from "@/types";

/**
 * qty × unit price, and the VAT on it.
 *
 * Separate from `computeOrderLine` so the FORM can show a running total while
 * somebody is typing, using the same arithmetic and the same rounding as the
 * read path — which is what stops the figure on screen and the figure the
 * order is worth from disagreeing by a penny.
 */
export function orderLineTotals(
  qty: number | string,
  unit_price: number | string,
  vat_rate: number | string
): { line_net: number; line_vat: number; line_gross: number } {
  const line_net = round2((Number(qty) || 0) * (Number(unit_price) || 0));
  const line_vat = round2((line_net * (Number(vat_rate) || 0)) / 100);
  return { line_net, line_vat, line_gross: round2(line_net + line_vat) };
}

/** One line's arithmetic, plus what is still outstanding on it. */
export function computeOrderLine(
  line: PurchaseOrderLine
): PurchaseOrderLineView {
  const ordered = Number(line.qty_ordered) || 0;
  const received = Number(line.qty_received) || 0;
  const { line_net, line_vat, line_gross } = orderLineTotals(
    ordered,
    line.unit_price,
    line.vat_rate
  );
  return {
    ...line,
    line_net,
    line_vat,
    line_gross,
    // Floored at zero: a negative outstanding is an over-delivery, and it is
    // reported as one rather than as "minus four still to come".
    qty_outstanding: Math.max(0, round2(ordered - received)),
    over_delivered: received > ordered + 0.001,
  };
}

/**
 * Is every line at least fully delivered?
 *
 * An order with no lines is NOT fully received — it is an empty order, and
 * saying "received" about nothing would let a draft with no content sit in the
 * done pile.
 */
export function fullyReceived(lines: PurchaseOrderLineView[]): boolean {
  if (lines.length === 0) return false;
  return lines.every((l) => l.qty_received + 0.001 >= l.qty_ordered);
}

/**
 * Attach everything a PO screen shows, including the match back to invoices.
 *
 * `invoices` is the set of purchases carrying this order's id. Cancelled ones
 * are excluded by the caller, the same rule ACTIVE_PURCHASE applies
 * everywhere else — a cancelled invoice is not evidence of a price.
 *
 * `price_variance` is null, not zero, when nothing has been invoiced yet.
 * Zero would read as "the order came in exactly on budget", which is a
 * different and much more reassuring statement than "no invoice has arrived".
 */
export function computeOrder(
  order: PurchaseOrder,
  lines: PurchaseOrderLine[],
  invoices: Purchase[],
  names: {
    suppliers?: Map<string, string>;
    tasks?: Map<string, string>;
  } = {}
): PurchaseOrderView {
  const lineViews = lines
    .slice()
    .sort((a, b) => a.line_no - b.line_no)
    .map(computeOrderLine);

  const net = round2(lineViews.reduce((s, l) => s + l.line_net, 0));
  const vat = round2(lineViews.reduce((s, l) => s + l.line_vat, 0));
  const invoiced_net = round2(
    invoices.reduce((s, p) => s + Number(p.net_total), 0)
  );

  return {
    ...order,
    supplier_name: order.supplier_id
      ? names.suppliers?.get(order.supplier_id) ?? null
      : null,
    task_name: order.task_id ? names.tasks?.get(order.task_id) ?? null : null,
    lines: lineViews,
    net,
    vat,
    gross: round2(net + vat),
    line_count: lineViews.length,
    fully_received: fullyReceived(lineViews),
    invoice_count: invoices.length,
    invoiced_net,
    // Ex-VAT on both sides. Comparing an ex-VAT order against an incl-VAT
    // invoice total would repeat the 2026-08-06 double-VAT error in a new
    // place, and it would do it in the one figure this table exists for.
    price_variance: invoices.length === 0 ? null : round2(invoiced_net - net),
  };
}

/**
 * Orders that have been sent and have not fully arrived by the date they were
 * promised. The one question a PO list exists to answer.
 */
export function overdueOrders(
  orders: PurchaseOrderView[],
  today: string
): PurchaseOrderView[] {
  return orders
    .filter(
      (o) =>
        (o.status === "sent" || o.status === "part_received") &&
        o.expected_delivery !== null &&
        o.expected_delivery < today
    )
    .sort((a, b) =>
      (a.expected_delivery ?? "").localeCompare(b.expected_delivery ?? "")
    );
}

/**
 * Suggest the order an arriving invoice belongs to.
 *
 * Same supplier, and still open. Deliberately a SUGGESTION and never an
 * automatic match: guessing here would tie an invoice to the wrong order and
 * then report a price variance that never happened, which is worse than
 * leaving it unmatched. The reviewer picks.
 */
export function candidateOrders(
  orders: PurchaseOrder[],
  supplierId: string | null
): PurchaseOrder[] {
  if (!supplierId) return [];
  return orders
    .filter(
      (o) =>
        o.supplier_id === supplierId &&
        o.status !== "cancelled" &&
        o.status !== "draft"
    )
    .sort((a, b) => b.raised_on.localeCompare(a.raised_on));
}

/**
 * Line-level over-delivery across a whole project: ordered 40, took 48.
 *
 * Kept separate from the price variance because they are different failures
 * with different fixes — one is a merchant sending too much, the other is a
 * merchant charging too much — and a single "something is wrong with this
 * order" figure would hide both.
 */
export function overDeliveredLines(
  orders: PurchaseOrderView[]
): { order: PurchaseOrderView; line: PurchaseOrderLineView }[] {
  const out: { order: PurchaseOrderView; line: PurchaseOrderLineView }[] = [];
  for (const order of orders)
    for (const line of order.lines)
      if (line.over_delivered) out.push({ order, line });
  return out;
}

/**
 * Which invoice lines were bought against an order, for the detail screen.
 *
 * Matching is by the parent purchase's `purchase_order_id` only. There is no
 * line-to-line match: merchants split and merge lines between the order and
 * the invoice constantly, and a fuzzy line match would produce confident,
 * wrong pairings.
 */
export function orderInvoiceLines(
  invoices: Purchase[],
  allLines: PurchaseLine[]
): PurchaseLine[] {
  const ids = new Set(invoices.map((p) => p.id));
  return allLines.filter((l) => ids.has(l.purchase_id));
}
