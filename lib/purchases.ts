// Purchase calculation helpers — the transaction core's answer to
// lib/calculations.ts.
//
// A purchase's balance and its Paid / Partial / Pending status are NOT stored.
// They are derived on every read from the purchase's gross total and its
// payment rows, so they can never drift the way a stored balance does.
// gross_total itself is a generated column in Postgres (net_total + vat_total),
// so it cannot drift either — read it, never write it.

import type {
  ExpenseEntry,
  ExpenseEntryComputed,
  InvoiceLineView,
  ItemPricePoint,
  Payment,
  Purchase,
  PurchaseComputed,
  PurchaseEntrySource,
  PurchaseStatus,
  PurchaseTotals,
  PriceMove,
} from "@/types";

// Float-rounding tolerance, not a business rule. Same value buildTrades uses in
// lib/summary.ts, so the two always agree on what counts as settled.
export const SETTLED_TOLERANCE = 0.001;

// Σ of what was actually handed over. Payment amounts are incl-VAT, so they are
// measured against gross_total, never against net_total (about.md §3.1).
export function paymentTotal(payments: Payment[]): number {
  return payments.reduce((sum, p) => sum + Number(p.amount), 0);
}

export function purchaseStatus(gross: number, paid: number): PurchaseStatus {
  if (paid > 0 && gross - paid <= SETTLED_TOLERANCE) return "Paid";
  if (paid > 0) return "Partial";
  return "Pending";
}

// Attach the computed payment fields to a purchase.
export function computePurchase(
  purchase: Purchase,
  payments: Payment[] = []
): PurchaseComputed {
  const gross = Number(purchase.gross_total);
  const paid = paymentTotal(payments);
  return {
    ...purchase,
    paid,
    balance: gross - paid,
    status: purchaseStatus(gross, paid),
  };
}

// Same, for a list — payments are indexed by purchase_id once rather than
// scanned per purchase.
export function computePurchases(
  purchases: Purchase[],
  payments: Payment[] = []
): PurchaseComputed[] {
  const byPurchase = new Map<string, Payment[]>();
  for (const p of payments) {
    const arr = byPurchase.get(p.purchase_id) ?? [];
    arr.push(p);
    byPurchase.set(p.purchase_id, arr);
  }
  return purchases.map((purchase) =>
    computePurchase(purchase, byPurchase.get(purchase.id) ?? [])
  );
}

// Normalise a supplier or item name into its matching key. Deliberately the
// same rule as priceKey() in lib/summary.ts and public.norm_key() in the
// database (migration 0008), so all three agree on what one item is.
export function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// ============================================================
// Phase 2 — the header is the sum of its lines
// ============================================================

// Money is stored to the penny. Rounding here rather than at the database
// keeps the live totals in the form identical to what is saved.
export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export interface LineAmounts {
  line_net: number | string;
  vat_rate: number | string;
}

// net_total and vat_total ARE columns on purchases — they have to be, because
// gross_total is generated from them — but they are never typed by hand. They
// are the sum of the lines, computed here on save, so the header can never
// disagree with the document it describes.
//
// VAT is rounded per line and then added, the same order migration 0008's
// backfill used, so a one-line purchase created here and one copied from an
// expense row carry the same pennies.
export function purchaseTotalsFromLines(lines: LineAmounts[]): {
  net_total: number;
  vat_total: number;
  gross_total: number;
} {
  let net = 0;
  let vat = 0;
  for (const line of lines) {
    const lineNet = round2(Number(line.line_net) || 0);
    net += lineNet;
    vat += round2((lineNet * (Number(line.vat_rate) || 0)) / 100);
  }
  const net_total = round2(net);
  const vat_total = round2(vat);
  return { net_total, vat_total, gross_total: round2(net_total + vat_total) };
}

// A penny of slack: invoices carry their own roundings, and a line that is out
// by more than this was mistyped rather than rounded. Same tolerance the
// existing expense form uses for its qty × unit cost check (about.md §10.1).
export const LINE_ARITHMETIC_TOLERANCE = 0.01;

// qty × unit price should normally equal the line net. When it does not, one
// of the three numbers is wrong — but not always: invoices carry discounts and
// part-loads, so this is a warning, never a rejection.
export function lineArithmeticGap(
  qty: number,
  unit_price: number,
  line_net: number
): { expected: number; stated: number } | null {
  if (qty <= 0 || unit_price <= 0 || line_net <= 0) return null;
  const expected = round2(qty * unit_price);
  if (Math.abs(expected - line_net) <= LINE_ARITHMETIC_TOLERANCE) return null;
  return { expected, stated: line_net };
}

// ============================================================
// Phase 1 — ordering, unit handling and per-source totals
// ============================================================

// Cancelled purchases are excluded from every figure on these screens, exactly
// as ACTIVE does for expense entries in lib/summary.ts. entry_status is the
// lifecycle flag, not a payment state (about.md §4.6).
export const ACTIVE_PURCHASE = (p: Purchase) => p.entry_status !== "Cancelled";

// What to sort a purchase by on a timeline.
//
// `purchase_date` is the only date the legacy rows carry, and it is really the
// PAID date — null on the 91 rows that were never paid (about.md §4.6). Falling
// back to created_at is exactly what purchaseDate() already does in
// lib/summary.ts, so the two order the same history the same way. It also means
// an undated row sorts by when it was imported, which can scramble a sequence —
// the same caveat §6.8 records for the Price Tracker.
export function purchaseOrderKey(p: {
  purchase_date: string | null;
  created_at: string;
}): number {
  return new Date(p.purchase_date || p.created_at).getTime();
}

// The unit as written, reduced to a comparison key. Missing becomes "", which
// is a value in its own right: "no unit was recorded".
export function normaliseUnit(unit: string | null): string {
  return (unit ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Two prices are only comparable when they are per the same unit.
//
// Two rows that BOTH record no unit compare as equal — that is the whole legacy
// dataset, where `unit` is null everywhere, and it is the basis the existing
// Price Tracker already compares on. A recorded unit never compares equal to a
// missing one: "£12 a bag" against "£12 for something unstated" is not a
// comparison, and a percentage drawn from it would be a lie.
export function unitsComparable(a: string | null, b: string | null): boolean {
  return normaliseUnit(a) === normaliseUnit(b);
}

export interface PricedObservation {
  unit_price: number;
  unit: string | null;
}

// Compare one priced observation against the previous one for the same item.
// Returns a null delta whenever no honest percentage exists — first buy, or the
// unit changed. Callers must render the 'unit_change' case as a note about the
// units, never as a number (see the evolution summary, "Unit handling").
export function comparePrice(
  current: PricedObservation,
  previous: PricedObservation | null
): { delta_pct: number | null; move: PriceMove } {
  if (!previous || previous.unit_price <= 0)
    return { delta_pct: null, move: "first" };
  if (!unitsComparable(current.unit, previous.unit))
    return { delta_pct: null, move: "unit_change" };
  const delta_pct =
    ((current.unit_price - previous.unit_price) / previous.unit_price) * 100;
  // Same 0.001 tolerance buildPriceHistory uses for "no change".
  if (Math.abs(delta_pct) < SETTLED_TOLERANCE)
    return { delta_pct, move: "same" };
  return { delta_pct, move: delta_pct > 0 ? "up" : "down" };
}

// ============================================================
// Expense form price advisories — one merged history per material
// ============================================================
// ExpenseForm's "have I paid more?" warning used to read expense_entries
// alone. The spreadsheet import that filled that table was removed on
// 2026-08-20, so it has nothing left to compare against — even though the
// same material's price history now lives in purchase_lines, one row per
// invoice line (about.md §8.1). This merges both into a single most-recent
// priced observation per material so the warning can fire again.
//
// Same rules as the rest of the transaction core:
//   • Cancelled rows are dropped, and so is the ledger side (about.md §5) —
//     empty today, but the filter stays in place regardless.
//   • A unit price of 0 is not a price and never enters the comparison.
//   • Matching is on the normalised description — the same key priceKey()
//     already uses for expense_entries, kept in step with normaliseName()
//     here and public.norm_key() in the database.
//   • The percentage itself is always comparePrice()'s, never recomputed by
//     hand, so a unit mismatch renders as a note instead of an invented
//     number — expense_entries has no unit column, so the entries side of
//     this always carries unit: null, and comparePrice's own rule ("a known
//     unit never compares equal to an unknown one") does the rest.

export interface MaterialPriceObservation extends PricedObservation {
  date: string | null;
  supplier: string | null;
}

type PricedEntry = Pick<
  ExpenseEntry,
  | "id"
  | "description"
  | "category"
  | "status"
  | "source"
  | "unit_cost"
  | "supplier"
  | "paid_date"
  | "created_at"
>;

type PricedLine = Pick<
  InvoiceLineView,
  "description" | "unit_price" | "unit" | "date" | "supplier" | "entry_source"
>;

/**
 * The most recent priced observation of each material, keyed by
 * normaliseName(description), combining hand-entered diary rows with invoice
 * lines for the same project.
 */
export function buildMaterialPriceIndex(
  entries: PricedEntry[],
  invoiceLines: PricedLine[],
  excludeEntryId?: string
): Map<string, MaterialPriceObservation> {
  const held = new Map<string, MaterialPriceObservation & { rank: number }>();

  const consider = (key: string, obs: MaterialPriceObservation, rank: number) => {
    if (!key) return;
    const current = held.get(key);
    if (!current || rank >= current.rank) held.set(key, { ...obs, rank });
  };

  for (const e of entries) {
    if (e.id === excludeEntryId) continue;
    if (e.category !== "Materials") continue;
    if (e.status === "Cancelled") continue;
    if (e.source === "ledger") continue;
    const unit_price = Number(e.unit_cost);
    if (unit_price <= 0) continue;
    const dateStr = e.paid_date || e.created_at;
    consider(
      normaliseName(e.description),
      { unit_price, unit: null, date: e.paid_date, supplier: e.supplier },
      new Date(dateStr).getTime()
    );
  }

  for (const l of invoiceLines) {
    if (l.entry_source === "ledger") continue;
    if (l.unit_price <= 0) continue;
    consider(
      normaliseName(l.description),
      { unit_price: l.unit_price, unit: l.unit, date: l.date, supplier: l.supplier },
      l.date ? new Date(l.date).getTime() : Number.NEGATIVE_INFINITY
    );
  }

  const result = new Map<string, MaterialPriceObservation>();
  for (const [key, { rank, ...obs }] of held) result.set(key, obs);
  return result;
}

// Split a set of purchases into one gross/paid/balance total per entry_source,
// diary first. Never returns a combined figure — adding the two double-counts
// the same spend (about.md §5).
export function totalsBySource(purchases: PurchaseComputed[]): PurchaseTotals[] {
  const map = new Map<PurchaseEntrySource, PurchaseTotals>();
  for (const p of purchases) {
    const row = map.get(p.entry_source) ?? {
      entry_source: p.entry_source,
      purchase_count: 0,
      gross: 0,
      paid: 0,
      balance: 0,
    };
    row.purchase_count += 1;
    row.gross += Number(p.gross_total);
    row.paid += p.paid;
    row.balance = row.gross - row.paid;
    map.set(p.entry_source, row);
  }
  const order: PurchaseEntrySource[] = ["diary", "ledger"];
  return order.filter((s) => map.has(s)).map((s) => map.get(s)!);
}

// The most recent purchase_date in a set, ignoring the rows that have none.
export function lastPurchaseDate(purchases: Purchase[]): string | null {
  let latest: string | null = null;
  for (const p of purchases) {
    if (!p.purchase_date) continue;
    if (!latest || p.purchase_date > latest) latest = p.purchase_date;
  }
  return latest;
}

// Build one item's price timeline, oldest → newest.
//
// The delta chain runs WITHIN a single entry_source. Diary and ledger are two
// records of the same job (about.md §5), so chaining across them would compare
// a purchase against itself and invent a price movement that never happened.
// Lines with no unit price stay in the list — "when did I last buy this" is
// still worth answering — but they neither carry a delta nor advance the chain.
export function buildItemTimeline(
  lines: {
    id: string;
    purchase_id: string;
    description_raw: string;
    qty: number;
    unit: string | null;
    unit_price: number;
    line_net: number;
    line_no: number;
  }[],
  purchaseById: Map<string, Purchase>,
  supplierNames: Map<string, string>,
  projectNames: Map<string, string>
): ItemPricePoint[] {
  const rows = lines
    .map((line) => ({ line, purchase: purchaseById.get(line.purchase_id) }))
    .filter(
      (r): r is { line: (typeof lines)[number]; purchase: Purchase } =>
        r.purchase !== undefined
    )
    .sort(
      (a, b) =>
        purchaseOrderKey(a.purchase) - purchaseOrderKey(b.purchase) ||
        a.line.line_no - b.line.line_no
    );

  const lastPriced = new Map<PurchaseEntrySource, PricedObservation>();

  return rows.map(({ line, purchase }) => {
    const unit_price = Number(line.unit_price);
    const previous = lastPriced.get(purchase.entry_source) ?? null;
    const { delta_pct, move } =
      unit_price > 0
        ? comparePrice({ unit_price, unit: line.unit }, previous)
        : { delta_pct: null, move: "first" as PriceMove };
    if (unit_price > 0)
      lastPriced.set(purchase.entry_source, { unit_price, unit: line.unit });

    return {
      line_id: line.id,
      purchase_id: purchase.id,
      project_id: purchase.project_id,
      date: purchase.purchase_date,
      entry_source: purchase.entry_source,
      supplier_id: purchase.supplier_id,
      supplier_name: purchase.supplier_id
        ? supplierNames.get(purchase.supplier_id) ?? null
        : null,
      project_name: projectNames.get(purchase.project_id) ?? null,
      invoice_no: purchase.invoice_no,
      description_raw: line.description_raw,
      qty: Number(line.qty),
      unit: line.unit,
      unit_price,
      line_net: Number(line.line_net),
      delta_pct,
      move,
      previous_unit: previous?.unit ?? null,
    };
  });
}

// ============================================================
// Invoice → expense bridge
// ============================================================
// Convert purchases (the transaction core) into synthetic ExpenseEntryComputed
// objects so they can be merged into the entries array that every calculation
// function already consumes. Nothing changes in buildSummary / buildTrades /
// buildMaterialLedger / buildPriceHistory — they all just see more rows.
//
// Mapping rationale
//   • gross_total (net + vat generated column) → total_incl_vat / actual_amount
//   • quoted_gross                             → quoted_amount (may be null)
//   • paid (Σ payments)                        → paid_amount
//   • balance (gross − paid)                   → remaining
//   • vat_total                                → vat_amount
//   • net_total                                → subtotal (ex-VAT)
//   • category / trade / week_no / supplier    → forwarded as-is
//   • source                                   → "invoice" (new union member)
//
// Price Tracker (buildPriceHistory) only fires for entries where
// unit_cost > 0 AND category = "Materials". A purchase-level synthetic entry
// has no unit cost (that lives on the lines), so it will not appear in the
// Price Tracker — which is the correct, honest behaviour.

export function purchasesToSyntheticEntries(
  purchases: PurchaseComputed[],
  supplierNames: Map<string, string>
): ExpenseEntryComputed[] {
  // Cancelled invoices are deliberately NOT filtered out here, unlike almost
  // everywhere else. This feeds the Expenses list, and you cannot un-cancel
  // what you cannot see — cancelling one from the status dropdown used to make
  // the row vanish with no way back. Every consumer of these entries already
  // drops `status === "Cancelled"` from its figures, so including them costs
  // nothing but a visible row. The purchases screen lists them for the same
  // reason (about.md §6.2).
  return purchases
    .map((p): ExpenseEntryComputed => {
      const gross = Number(p.gross_total);
      const vat = Number(p.vat_total);
      const net = Number(p.net_total);
      const paid = Number(p.paid);
      const quoted = p.quoted_gross != null ? Number(p.quoted_gross) : gross;
      const supplierName = p.supplier_id
        ? (supplierNames.get(p.supplier_id) ?? null)
        : null;

      return {
        // Required identity fields — fabricated so they never collide with real
        // expense_entry rows (which use UUIDs from the database).
        id: `inv:${p.id}`,
        user_id: p.user_id,
        project_id: p.project_id,
        // Contextual fields
        week_number: p.week_no ?? 1,
        description: p.invoice_no
          ? `Invoice ${p.invoice_no}${supplierName ? ` – ${supplierName}` : ""}`
          : supplierName
            ? `Invoice – ${supplierName}`
            : "Invoice",
        category: p.category ?? null,
        trade: p.trade ?? null,
        location_room: p.location_room ?? null,
        notes: p.notes ?? null,
        supplier: supplierName,
        invoice_ref: p.invoice_no,
        // Dates / payment
        paid_date: p.purchase_date,
        payment_method: null,
        // Cost model — maps invoice totals onto the expense entry fields.
        quoted_amount: quoted,
        actual_amount: net,
        paid_amount: paid,
        qty: 0,
        unit_cost: 0,
        vat_rate: net > 0 ? Math.round((vat / net) * 100) : 0,
        // Lifecycle
        status: p.entry_status,
        receipt_url: null,
        source: "invoice",
        created_at: p.created_at,
        updated_at: p.updated_at,
        // Computed fields (mirrors computeEntry logic)
        materials_cost: 0,
        subtotal: net,
        vat_amount: vat,
        total_incl_vat: gross,
        remaining: gross - paid,
      };
    });
}
