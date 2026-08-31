// Project screens built from invoice data — the four pivots of the Analysis
// tab (by trade, by supplier, by material, price history), which were five
// separate tabs until 2026-08-28. The builders are unchanged by that collapse:
// it grouped the same rows five ways then and four ways now.
//
// Why these do not live in lib/summary.ts
// ---------------------------------------
// lib/summary.ts aggregates `expense_entries`, where the money is one number
// per row. That was fine for the week-by-week spreadsheet, but the spreadsheet
// was removed: too many of its rows recorded a total and nothing else, so the
// Price Tracker — which compares £/unit — had nothing to compare.
//
// An invoice does carry that detail, one line at a time: what was bought, how
// many, in what unit, at what price each. So these builders read
// `purchase_lines` joined to their parent `purchases`, and every figure below
// is a sum of real lines rather than a total someone typed.
//
// Rules that hold throughout, the same ones lib/summary.ts and lib/purchases.ts
// already follow:
//   • Cancelled purchases are excluded from every figure (ACTIVE_PURCHASE).
//   • VAT is computed per line and then added, never on the rounded sum, so a
//     line total here matches what purchaseTotalsFromLines wrote to the header.
//   • Payment lives on the document, not the line. A line can never say what it
//     cost you, only what it was billed at — so nothing below splits a payment
//     across lines. Paid / balance figures always come from whole invoices.
//   • Two prices are only comparable per the same unit (comparePrice), so a
//     "bag → tonne" change is reported as a unit change and never as a
//     percentage.

import {
  ACTIVE_PURCHASE,
  comparePrice,
  normaliseName,
  purchaseOrderKey,
  purchaseStatus,
  round2,
} from "@/lib/purchases";
import type { PricedObservation } from "@/lib/purchases";
import type {
  ExpenseCategory,
  InvoiceLineView,
  ItemPriceRow,
  ItemPriceRowPoint,
  PurchaseComputed,
  PurchaseLine,
  SupplierInvoiceRow,
  TradeInvoiceRow,
} from "@/types";

const NO_SUPPLIER = "No supplier";
const UNASSIGNED_TRADE = "Unassigned";

const laterDate = (a: string | null, b: string | null): string | null => {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
};

// Distinct, order-preserving, blanks dropped.
function addOnce(list: string[], value: string | null | undefined): void {
  const text = value?.trim();
  if (!text || list.includes(text)) return;
  list.push(text);
}

// ============================================================
// The flat line list every screen below reads
// ============================================================

/**
 * Flatten this project's invoice lines, carrying down everything the header
 * knows (supplier, date, trade, category, status).
 *
 * Lines whose purchase is missing or Cancelled are dropped — a line with no
 * document behind it is money nothing explains.
 */
export function buildInvoiceLines(
  purchases: PurchaseComputed[],
  lines: PurchaseLine[],
  supplierNames: Map<string, string>,
  itemNames: Map<string, string>
): InvoiceLineView[] {
  const byId = new Map(
    purchases.filter(ACTIVE_PURCHASE).map((p) => [p.id, p])
  );

  return lines
    .map((line) => {
      const purchase = byId.get(line.purchase_id);
      if (!purchase) return null;

      const line_net = round2(Number(line.line_net));
      const vat_rate = Number(line.vat_rate) || 0;
      const vat_amount = round2((line_net * vat_rate) / 100);
      const description = line.description_raw?.trim() || "(no description)";

      return {
        line_id: line.id,
        purchase_id: purchase.id,
        project_id: purchase.project_id,
        week_no: purchase.week_no,
        date: purchase.purchase_date,
        invoice_no: purchase.invoice_no,
        supplier_id: purchase.supplier_id,
        supplier: purchase.supplier_id
          ? supplierNames.get(purchase.supplier_id) ?? NO_SUPPLIER
          : NO_SUPPLIER,
        item_id: line.item_id,
        item_name:
          (line.item_id ? itemNames.get(line.item_id) : null) ?? description,
        description,
        category: purchase.category,
        trade: purchase.trade,
        qty: Number(line.qty) || 0,
        unit: line.unit,
        unit_price: Number(line.unit_price) || 0,
        line_net,
        vat_rate,
        vat_amount,
        line_gross: round2(line_net + vat_amount),
        entry_status: purchase.entry_status,
        entry_source: purchase.entry_source,
        purchase_status: purchase.status,
      } satisfies InvoiceLineView;
    })
    .filter((l): l is InvoiceLineView => l !== null)
    .sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.invoice_no ?? "").localeCompare(b.invoice_no ?? "") ||
        a.item_name.localeCompare(b.item_name)
    );
}

/**
 * What the Materials tab lists: everything that is not labour.
 *
 * Deliberately "not Labour" rather than "is Materials". Category is optional on
 * a purchase and the invoice extractor does not set it, so requiring
 * `category === "Materials"` hid every uploaded invoice — the tab read "no
 * materials" while the lines sat in the database. A line for bricks is a
 * material whether or not anyone ticked the box, and an uncategorised line is
 * labelled as such on screen rather than dropped.
 */
export function materialLines(lines: InvoiceLineView[]): InvoiceLineView[] {
  return lines.filter((l) => l.category !== "Labour");
}

/**
 * What the Labour tab lists.
 *
 * The mirror image is NOT true: labour has to be marked as labour. Guessing
 * that an uncategorised line is labour would move real money between the two
 * screens on no evidence, and the Labour figure is the one that gets quoted at
 * people.
 */
export function labourLines(lines: InvoiceLineView[]): InvoiceLineView[] {
  return lines.filter((l) => l.category === "Labour");
}

// ============================================================
// Trades — one row per trade, built from whole invoices
// ============================================================

// A shared accumulator, because Trades and Suppliers ask the same question of
// the same invoices and only differ in what they group by.
interface Bucket {
  invoice_count: number;
  line_count: number;
  quoted: number;
  net: number;
  vat: number;
  gross: number;
  paid: number;
  last_date: string | null;
  names: string[]; // suppliers for a trade row, categories for a supplier row
}

const emptyBucket = (): Bucket => ({
  invoice_count: 0,
  line_count: 0,
  quoted: 0,
  net: 0,
  vat: 0,
  gross: 0,
  paid: 0,
  last_date: null,
  names: [],
});

function accumulate(
  bucket: Bucket,
  purchase: PurchaseComputed,
  lineCount: number
): void {
  bucket.invoice_count += 1;
  bucket.line_count += lineCount;
  // quoted_gross is null on everything that was invoiced without a quote
  // first, which is most of it. Treated as 0 so the column adds up; the
  // screens say "—" when the whole column is zero rather than "£0.00".
  bucket.quoted += Number(purchase.quoted_gross ?? 0);
  bucket.net += Number(purchase.net_total);
  bucket.vat += Number(purchase.vat_total);
  bucket.gross += Number(purchase.gross_total);
  bucket.paid += purchase.paid;
  bucket.last_date = laterDate(bucket.last_date, purchase.purchase_date);
}

// Takes anything that knows which purchase it belongs to, so callers can pass
// either raw purchase_lines or the flattened InvoiceLineViews they already hold.
function lineCounts(lines: HasPurchaseId[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines)
    counts.set(line.purchase_id, (counts.get(line.purchase_id) ?? 0) + 1);
  return counts;
}

interface HasPurchaseId {
  purchase_id: string;
}

/**
 * The Trades screen: every invoice grouped by the trade it was filed under.
 *
 * Grouped on whole purchases rather than on lines, because `paid` is a
 * document-level fact — splitting a payment across a document's lines would
 * invent a number the payment record never stated.
 */
export function buildTradeRows(
  purchases: PurchaseComputed[],
  lines: HasPurchaseId[],
  supplierNames: Map<string, string>
): TradeInvoiceRow[] {
  const counts = lineCounts(lines);
  const map = new Map<string, Bucket>();

  for (const purchase of purchases.filter(ACTIVE_PURCHASE)) {
    const trade = purchase.trade?.trim() || UNASSIGNED_TRADE;
    const bucket = map.get(trade) ?? emptyBucket();
    accumulate(bucket, purchase, counts.get(purchase.id) ?? 0);
    addOnce(
      bucket.names,
      purchase.supplier_id ? supplierNames.get(purchase.supplier_id) : null
    );
    map.set(trade, bucket);
  }

  return [...map.entries()]
    .map(([trade, b]) => ({
      trade,
      invoice_count: b.invoice_count,
      line_count: b.line_count,
      suppliers: b.names,
      quoted: round2(b.quoted),
      net: round2(b.net),
      vat: round2(b.vat),
      gross: round2(b.gross),
      paid: round2(b.paid),
      balance: round2(b.gross - b.paid),
      status: purchaseStatus(b.gross, b.paid),
      last_date: b.last_date,
    }))
    .sort((a, b) => b.gross - a.gross || a.trade.localeCompare(b.trade));
}

// ============================================================
// Suppliers — the same invoices, grouped by who they came from
// ============================================================

/** The Suppliers screen, scoped to one project. */
export function buildSupplierRows(
  purchases: PurchaseComputed[],
  lines: HasPurchaseId[],
  supplierNames: Map<string, string>
): SupplierInvoiceRow[] {
  const counts = lineCounts(lines);
  // Keyed by supplier_id, with one shared bucket for every header that names
  // no supplier at all.
  const map = new Map<string, { id: string | null; name: string; bucket: Bucket }>();

  for (const purchase of purchases.filter(ACTIVE_PURCHASE)) {
    const id = purchase.supplier_id;
    const name = id ? supplierNames.get(id) ?? NO_SUPPLIER : NO_SUPPLIER;
    const key = id ?? "__none__";
    const held = map.get(key) ?? { id, name, bucket: emptyBucket() };
    accumulate(held.bucket, purchase, counts.get(purchase.id) ?? 0);
    addOnce(held.bucket.names, purchase.category);
    map.set(key, held);
  }

  return [...map.values()]
    .map(({ id, name, bucket: b }) => ({
      supplier_id: id,
      supplier: name,
      invoice_count: b.invoice_count,
      line_count: b.line_count,
      net: round2(b.net),
      vat: round2(b.vat),
      gross: round2(b.gross),
      paid: round2(b.paid),
      balance: round2(b.gross - b.paid),
      status: purchaseStatus(b.gross, b.paid),
      last_date: b.last_date,
      categories: b.names,
    }))
    .sort((a, b) => b.gross - a.gross || a.supplier.localeCompare(b.supplier));
}

// ============================================================
// Price Tracker — £ per unit, over time, per item
// ============================================================

// What one item is. Prefer the matched item_id, because two spellings that
// resolved to the same item are the same thing and their prices belong on one
// timeline. Unmatched lines fall back to the normalised description, which is
// the same rule priceKey() and public.norm_key() use.
function itemKey(line: InvoiceLineView): string {
  return line.item_id ?? `raw:${normaliseName(line.item_name)}`;
}

/**
 * Group every priced line by item and work out how the unit price moved.
 *
 * Lines with no unit price stay out of the timeline entirely: "£0 per unit"
 * is not a price, and letting one in would invent a −100% drop followed by an
 * infinite rise. An item that has never been priced simply does not appear
 * here, which is honest rather than a gap.
 */
export function buildItemPriceRows(lines: InvoiceLineView[]): ItemPriceRow[] {
  const groups = new Map<string, InvoiceLineView[]>();
  for (const line of lines) {
    if (line.unit_price <= 0) continue;
    const key = itemKey(line);
    if (!key || key === "raw:") continue;
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  const rows: ItemPriceRow[] = [];

  for (const list of groups.values()) {
    // Oldest → newest. Undated lines sort by nothing useful, so the invoice
    // number breaks the tie and keeps the sequence stable between renders.
    const sorted = list
      .slice()
      .sort(
        (a, b) =>
          (a.date ?? "").localeCompare(b.date ?? "") ||
          (a.invoice_no ?? "").localeCompare(b.invoice_no ?? "")
      );

    let previous: PricedObservation | null = null;
    const units: string[] = [];
    const suppliers: string[] = [];
    let total_qty = 0;
    let total_net = 0;
    let last_date: string | null = null;

    const points: ItemPriceRowPoint[] = sorted.map((line) => {
      const current: PricedObservation = {
        unit_price: line.unit_price,
        unit: line.unit,
      };
      const { delta_pct, move } = comparePrice(current, previous);
      const previous_unit = previous?.unit ?? null;
      previous = current;

      addOnce(units, line.unit);
      addOnce(suppliers, line.supplier);
      total_qty += line.qty;
      total_net += line.line_net;
      last_date = laterDate(last_date, line.date);

      return {
        line_id: line.line_id,
        purchase_id: line.purchase_id,
        date: line.date,
        supplier: line.supplier,
        invoice_no: line.invoice_no,
        qty: line.qty,
        unit: line.unit,
        unit_price: line.unit_price,
        line_net: line.line_net,
        delta_pct,
        move,
        previous_unit,
      };
    });

    const first = points[0];
    const latest = points[points.length - 1];

    rows.push({
      item_id: sorted[0].item_id,
      // The most recent spelling wins: it is what the last document called it.
      item: sorted[sorted.length - 1].item_name,
      units,
      purchase_count: points.length,
      total_qty: round2(total_qty),
      total_net: round2(total_net),
      suppliers,
      first_price: first.unit_price,
      latest_price: latest.unit_price,
      latest_delta_pct: latest.delta_pct,
      trend: latest.move,
      last_date,
      points,
    });
  }

  // Biggest recent rise first, then everything with no movement to report.
  // `latest_delta_pct` is null for a first buy and for a unit change, and both
  // belong below the items that actually moved.
  return rows.sort((a, b) => {
    const aMoved = a.latest_delta_pct ?? Number.NEGATIVE_INFINITY;
    const bMoved = b.latest_delta_pct ?? Number.NEGATIVE_INFINITY;
    return bMoved - aMoved || a.item.localeCompare(b.item);
  });
}

/** Items whose latest buy cost more per unit than the one before it. */
export function buildItemPriceAlerts(rows: ItemPriceRow[]): ItemPriceRow[] {
  return rows.filter((r) => r.trend === "up" && (r.latest_delta_pct ?? 0) > 0);
}

/** Items whose unit changed on the latest buy, so no percentage is honest. */
export function buildUnitChangeAlerts(rows: ItemPriceRow[]): ItemPriceRow[] {
  return rows.filter((r) => r.trend === "unit_change");
}

// ============================================================
// Category totals from invoices
// ============================================================

export interface InvoiceCategoryTotal {
  category: ExpenseCategory | "Uncategorised";
  net: number;
  vat: number;
  gross: number;
  line_count: number;
}

/**
 * Spend per category, summed from lines rather than from purchase headers, so
 * a mixed invoice lands in more than one bucket only if its lines say so.
 *
 * Category is a header field today, so in practice every line of one invoice
 * shares one category — but summing the lines means this keeps working the day
 * a per-line category is added, and it always agrees with the Materials tab,
 * which lists exactly the lines counted here.
 */
export function buildInvoiceCategoryTotals(
  lines: InvoiceLineView[]
): InvoiceCategoryTotal[] {
  const map = new Map<string, InvoiceCategoryTotal>();
  for (const line of lines) {
    const category = line.category ?? "Uncategorised";
    const row =
      map.get(category) ??
      ({ category, net: 0, vat: 0, gross: 0, line_count: 0 } as InvoiceCategoryTotal);
    row.net += line.line_net;
    row.vat += line.vat_amount;
    row.gross += line.line_gross;
    row.line_count += 1;
    map.set(category, row);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      net: round2(r.net),
      vat: round2(r.vat),
      gross: round2(r.gross),
    }))
    .sort((a, b) => b.gross - a.gross);
}

/** Sort helper shared by the screens that show whole invoices, newest first. */
export function newestFirst(purchases: PurchaseComputed[]): PurchaseComputed[] {
  return purchases
    .slice()
    .sort((a, b) => purchaseOrderKey(b) - purchaseOrderKey(a));
}
