// Shared TypeScript types for RenovaTrack

export type ProjectStatus = "active" | "completed" | "paused";
export type ExpenseCategory = "Labour" | "Materials" | "Skip/Disposal" | "Other";
export type ExpenseStatus = "Planned" | "In Progress" | "Paid" | "Cancelled";
export type PaymentMethod = "Cash" | "Debit Card" | "Credit Card" | "Bank Transfer";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  target_budget: number;
  status: ProjectStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpenseEntry {
  id: string;
  user_id: string;
  project_id: string;
  week_number: number;
  description: string;
  category: ExpenseCategory | null;
  trade: string | null;
  location_room: string | null;
  notes: string | null;
  supplier: string | null;
  invoice_ref: string | null;
  paid_date: string | null;
  payment_method: PaymentMethod | null;
  // Quoted / Actual / Paid model (matches the real spend tracker).
  quoted_amount: number;
  actual_amount: number;
  paid_amount: number;
  // Materials detail — kept so we can track unit price over time.
  qty: number;
  unit_cost: number;
  vat_rate: number;
  status: ExpenseStatus;
  receipt_url: string | null;
  // 'diary' = week-by-week Expenses entries (File 1 + anything added in-app).
  // 'ledger' = imported reference rows (File 2) shown only in the Trades /
  // Materials & Suppliers tabs, not in the week-by-week Expenses list.
  source: "diary" | "ledger";
  created_at: string;
  updated_at: string;
}

// expense_entry + computed cost fields (never stored — computed on read)
export interface ExpenseEntryComputed extends ExpenseEntry {
  materials_cost: number; // qty × unit_cost (for the category split)
  subtotal: number; // = actual_amount
  vat_amount: number;
  total_incl_vat: number;
  remaining: number; // total_incl_vat − paid_amount
}

export interface TradeLookup {
  id: string;
  user_id: string;
  name: string;
  default_rate: number;
  default_markup_pct: number;
  created_at: string;
}

export interface ProjectWeek {
  id: string;
  user_id: string;
  project_id: string;
  week_number: number;
  completion_pct: number;
  notes: string | null;
}

export interface ProjectSummary {
  target_budget: number;
  total_quoted: number;
  forecast_total: number; // Σ actual incl VAT (non-cancelled)
  variance: number; // forecast_total − total_quoted (overrun vs quote)
  contingency_amount: number; // max(variance, 0)
  forecast_plus_contingency: number;
  paid_to_date: number;
  remaining_to_pay: number;
  weeks_tracked: number;
}

export interface WeekTotal {
  week_number: number;
  labour: number;
  materials: number;
  vat: number;
  total: number;
  completion_pct: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface TradeSummary {
  trade: string;
  quoted: number;
  actual: number;
  paid: number;
  remaining: number;
  status: "Paid" | "Partial" | "Pending";
}

export interface MaterialSummary {
  supplier: string;
  cost: number; // Σ actual_amount
  paid: number;
  remaining: number;
  vat: number;
  total: number;
  payment_methods: string[];
  entries: number;
}

// Per-purchase materials ledger row (mirrors the "Materials & Suppliers" sheet).
// Derived directly from expense entries with category = Materials.
export interface MaterialLedgerRow {
  id: string;
  week_number: number;
  item: string; // description
  supplier: string;
  unit_cost: number;
  qty: number;
  total: number; // total incl. VAT
  paid: number;
  remaining: number;
  paid_date: string | null;
  payment_method: PaymentMethod | null;
  notes: string | null;
}

// Price-over-time tracking — "did the same item cost more this time?"
export type PriceDirection = "up" | "down" | "same" | "first";

export interface PricePurchase {
  date: string | null;
  supplier: string | null;
  unit_cost: number;
  qty: number;
  total: number;
  delta_pct: number; // vs the previous purchase's unit_cost (0 for first)
  direction: PriceDirection;
}

export interface PriceHistoryItem {
  item: string; // display label (original-cased description)
  purchase_count: number;
  first_price: number;
  latest_price: number;
  latest_delta_pct: number; // latest vs previous purchase
  trend: PriceDirection;
  purchases: PricePurchase[]; // sorted oldest → newest
}

// ============================================================
// Transaction core (migration 0008) — suppliers, items, purchases.
// Nothing below is read by a screen yet; Phase 1 builds on it.
// ============================================================

// Where a purchase's data came from.
export type PurchaseOrigin =
  | "manual"
  | "excel"
  | "text"
  | "invoice_ocr"
  | "legacy_import";

// Which half of the app a purchase belongs to. Carried over from
// expense_entries.source: diary and ledger rows overlap, so summing them
// double-counts. Not the same question as PurchaseOrigin.
export type PurchaseEntrySource = "diary" | "ledger";

// Derived from payments, never stored.
export type PurchaseStatus = "Paid" | "Partial" | "Pending";

export interface Supplier {
  id: string;
  user_id: string;
  name: string;
  type: string | null;
  account_ref: string | null;
  notes: string | null;
  // ---- identity, added by migration 0010 ----
  // The only hard identifier an invoice carries. Everything else about a
  // merchant is spelling; this is the thing that proves "Lawsons" and
  // "Lawsons Timber Ltd" are one company. Unique per user when set.
  vat_number: string | null;
  address: string | null;
  // Which upload invented this supplier, when nothing matched. Null for the
  // ones seeded from the spreadsheet or typed by hand.
  created_from_upload_id: string | null;
  // true = created by the extractor and never confirmed by a human.
  is_unverified: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierAlias {
  id: string;
  user_id: string;
  supplier_id: string;
  alias: string;
  created_at: string;
}

export interface Item {
  id: string;
  user_id: string;
  canonical_name: string;
  category: ExpenseCategory | null;
  default_unit: string | null;
  pack_size: number | null;
  pack_unit: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemAlias {
  id: string;
  user_id: string;
  item_id: string;
  alias: string;
  created_at: string;
}

// One purchase = one document (invoice, receipt, agreed job), with N lines.
export interface Purchase {
  id: string;
  user_id: string;
  project_id: string;
  supplier_id: string | null;
  purchase_date: string | null;
  week_no: number | null;
  invoice_no: string | null;
  category: ExpenseCategory | null;
  trade: string | null;
  location_room: string | null;
  notes: string | null;
  // net + vat are ex-VAT and the VAT on it; gross_total is a GENERATED column
  // in Postgres (net_total + vat_total) — read it, never write it.
  net_total: number;
  vat_total: number;
  gross_total: number;
  // What was quoted, incl-VAT for the Glenferrie import. Deliberately outside
  // net/vat/gross, which describe what was actually spent.
  quoted_gross: number | null;
  origin: PurchaseOrigin;
  entry_source: PurchaseEntrySource;
  // The lifecycle flag copied from expense_entries.status — NOT a payment
  // state. 'Cancelled' rows are excluded from every summary.
  entry_status: ExpenseStatus;
  source_file_id: string | null;
  legacy_entry_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseLine {
  id: string;
  user_id: string;
  purchase_id: string;
  line_no: number;
  item_id: string | null;
  // What the document said, verbatim. Kept even after the item match changes.
  description_raw: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_net: number; // ex-VAT
  vat_rate: number; // one of VAT_RATES — 0, 5 or 20 (migration 0011)
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  purchase_id: string;
  paid_on: string | null;
  amount: number; // incl-VAT — what was actually handed over
  method: PaymentMethod | null;
  reference: string | null;
  created_at: string;
}

export interface Receipt {
  id: string;
  user_id: string;
  purchase_id: string;
  storage_path: string;
  uploaded_at: string;
}

// purchase + computed payment fields (never stored — computed on read,
// exactly like ExpenseEntryComputed).
export interface PurchaseComputed extends Purchase {
  paid: number; // Σ payments.amount
  balance: number; // gross_total − paid
  status: PurchaseStatus;
}

// ============================================================
// Phase 1 read models — what the supplier and item screens consume.
// All derived on read from the tables above; none of it is stored.
// ============================================================

// A gross / paid / balance triple for ONE entry_source. Diary and ledger are
// two overlapping records of the same job, so they are always reported side by
// side and never added together (about.md §5).
export interface PurchaseTotals {
  entry_source: PurchaseEntrySource;
  purchase_count: number;
  gross: number;
  paid: number;
  balance: number; // gross − paid
}

export interface SupplierListRow {
  supplier: Supplier;
  purchase_count: number; // records of any source — a count, not money
  totals: PurchaseTotals[]; // one per entry_source present, diary first
  last_purchase_date: string | null;
}

export interface PurchaseLineDetail extends PurchaseLine {
  item_name: string | null; // items.canonical_name, null when unmatched
}

export interface PurchaseDetail extends PurchaseComputed {
  lines: PurchaseLineDetail[];
  payments: Payment[];
  project_name: string | null;
  supplier_name: string | null;
  // Cumulative gross within this purchase's entry_source group, accumulated
  // oldest → newest. Never spans the two sources.
  running_total: number;
}

export interface SupplierPurchaseGroup {
  entry_source: PurchaseEntrySource;
  totals: PurchaseTotals;
  purchases: PurchaseDetail[]; // newest first
}

export interface SupplierBundle {
  supplier: Supplier;
  aliases: SupplierAlias[];
  groups: SupplierPurchaseGroup[];
}

// Like PriceDirection, plus the case the unit handling exists for:
// 'unit_change' means the unit differs from the previous purchase, so no
// honest percentage can be computed and none is shown.
export type PriceMove = PriceDirection | "unit_change";

export interface ItemListRow {
  item: Item;
  line_count: number;
  supplier_count: number;
  latest_unit_price: number | null; // null when nothing was ever priced
  latest_delta_pct: number | null; // null when first buy or units changed
  trend: PriceMove;
  last_purchase_date: string | null;
}

// One appearance of an item on one document.
export interface ItemPricePoint {
  line_id: string;
  purchase_id: string;
  project_id: string;
  date: string | null;
  entry_source: PurchaseEntrySource;
  supplier_id: string | null;
  supplier_name: string | null;
  project_name: string | null;
  invoice_no: string | null;
  description_raw: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_net: number;
  delta_pct: number | null;
  move: PriceMove;
  previous_unit: string | null; // what the unit was last time, for "bag → tonne"
}

export interface ItemSourceTotals {
  entry_source: PurchaseEntrySource;
  line_count: number;
  qty: number;
  net: number; // ex-VAT, Σ line_net
}

export interface ItemBundle {
  item: Item;
  aliases: ItemAlias[];
  points: ItemPricePoint[]; // oldest → newest
  totals: ItemSourceTotals[];
}

// ============================================================
// Phase 2 write models — what the multi-line invoice form sends.
// ============================================================
// Form fields arrive as strings; the numbers are coerced once, by
// buildPurchaseRows in lib/purchaseWrite.ts, so the client and the server
// coerce them the same way.

export interface PurchaseLineInput {
  // Present when editing a line that already exists. Not used as a key on
  // save — an edit replaces the whole line set — but it keeps the form and
  // the stored row visibly paired.
  id?: string | null;
  // Null means "work it out from description_raw": the server matches the
  // text against item aliases and creates the item if nothing matches.
  item_id?: string | null;
  description_raw: string;
  qty: number | string;
  unit: string | null;
  unit_price: number | string;
  line_net: number | string;
  vat_rate: number | string;
}

export interface PaymentInput {
  id?: string | null;
  paid_on: string | null;
  amount: number | string;
  method: PaymentMethod | "" | null;
  reference: string | null;
}

// One document. No totals: net, VAT and gross are the sum of the lines and
// are computed on save, never typed (about.md §2 rule 1 in spirit — the
// header may not disagree with the lines it is made of).
export interface PurchaseInput {
  supplier_name: string; // free text, resolved to a supplier row on save
  purchase_date: string | null;
  week_no: number | string | null;
  invoice_no: string | null;
  category: ExpenseCategory | "" | null;
  trade: string | null;
  location_room: string | null;
  notes: string | null;
  entry_status: ExpenseStatus;
  lines: PurchaseLineInput[];
  payments: PaymentInput[];
}

// ---- reference data the form needs to warn you about things ----

export interface SupplierRef {
  id: string;
  name: string;
  aliases: string[];
}

// The last time this item was bought at a recorded unit price, wherever it
// was. A comparison between two documents, not a sum, so it may cross
// entry_source — but which source it came from is shown, because diary and
// ledger overlap (about.md §5).
export interface ItemPriceRef {
  unit_price: number;
  unit: string | null;
  date: string | null;
  supplier_name: string | null;
  entry_source: PurchaseEntrySource;
}

export interface ItemRef {
  id: string;
  canonical_name: string;
  category: ExpenseCategory | null;
  default_unit: string | null;
  aliases: string[];
  last_price: ItemPriceRef | null;
}

// An invoice number already used, so the form can say "you have logged this
// one before" before it is saved a second time.
export interface InvoiceRef {
  purchase_id: string;
  project_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  invoice_no: string;
  purchase_date: string | null;
  gross: number;
}

export interface PurchaseFormBundle {
  project: Project;
  suppliers: SupplierRef[];
  items: ItemRef[];
  trades: TradeLookup[];
  units: string[]; // units already used, for the unit type-ahead
  next_week: number;
  invoices: InvoiceRef[];
}

// One purchase loaded back into the form for editing.
export interface PurchaseEditBundle {
  purchase: Purchase;
  lines: PurchaseLine[];
  payments: Payment[];
  supplier_name: string | null;
}

export interface ProjectPurchaseRow extends PurchaseComputed {
  supplier_name: string | null;
  line_count: number;
  payment_count: number;
  first_description: string | null;
}

export interface ProjectPurchaseList {
  project: Project;
  rows: ProjectPurchaseRow[]; // newest first
  totals: PurchaseTotals[]; // per entry_source, never combined
}

// ============================================================
// Invoice upload (migration 0010) — a photographed or PDF'd document on its
// way into `purchases`. Nothing here writes to purchases until a human
// accepts the review screen.
// ============================================================

//   pending    — uploaded, nothing read yet
//   processing — extraction in flight
//   extracted  — we have a proposal; waiting for a human
//   failed     — extraction gave up; `error` says why
//   committed  — accepted and written into purchases
export type InvoiceUploadStatus =
  | "pending"
  | "processing"
  | "extracted"
  | "failed"
  | "committed";

// 'text'   — the PDF carried a real text layer and we read it
// 'vision' — there was no text layer, so the page images were read instead
export type ExtractionMethod = "text" | "vision";

export interface InvoiceUpload {
  id: string;
  user_id: string;
  project_id: string;
  storage_path: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: InvoiceUploadStatus;
  error: string | null;
  // The extractor's answer exactly as it came back, for ever. Typed as unknown
  // because it is evidence, not a contract — validate it with the Zod schema
  // in lib/invoice/schema.ts before reading a field off it.
  extraction_raw: unknown;
  extraction_method: ExtractionMethod | null;
  page_count: number | null;
  // The purchase this upload became, once committed.
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

export const PURCHASE_ORIGINS: PurchaseOrigin[] = [
  "manual",
  "excel",
  "text",
  "invoice_ocr",
  "legacy_import",
];

export const PURCHASE_ENTRY_SOURCES: PurchaseEntrySource[] = ["diary", "ledger"];

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  "Labour",
  "Materials",
  "Skip/Disposal",
  "Other",
];

export const EXPENSE_STATUSES: ExpenseStatus[] = [
  "Planned",
  "In Progress",
  "Paid",
  "Cancelled",
];

export const PAYMENT_METHODS: PaymentMethod[] = [
  "Cash",
  "Debit Card",
  "Credit Card",
  "Bank Transfer",
];

export const PROJECT_STATUSES: ProjectStatus[] = ["active", "completed", "paused"];

// The rates HMRC currently levies, and exactly what the `vat_rate` CHECK on
// both `expense_entries` and `purchase_lines` allows (migration 0011):
//   0  — zero-rated or exempt
//   5  — the reduced rate, which a lot of residential renovation work carries
//   20 — the standard rate
// The CHECK rejects rather than coerces, so this list and the constraint have
// to be changed together — see the header of 0011_vat_reduced_rate.sql.
export const VAT_RATES = [0, 5, 20] as const;

export type VatRate = (typeof VAT_RATES)[number];

/** Is this a rate the database will actually accept? */
export function isVatRate(value: unknown): value is VatRate {
  return (VAT_RATES as readonly number[]).includes(Number(value));
}

/** "0, 5 or 20" — one wording for every message that lists the rates. */
export const VAT_RATES_SENTENCE = VAT_RATES.slice(0, -1)
  .join(", ")
  .concat(` or ${VAT_RATES[VAT_RATES.length - 1]}`);
