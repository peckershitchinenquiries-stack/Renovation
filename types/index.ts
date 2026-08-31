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
  // 'diary'   = week-by-week Expenses entries (File 1 + anything added in-app).
  // 'ledger'  = imported reference rows (File 2) shown only in the Trades /
  //             Materials & Suppliers tabs, not in the week-by-week Expenses list.
  // 'invoice' = synthetic entry generated from a Purchase row (purchases table).
  //             Treated like a diary entry for every calculation; read-only in
  //             the UI because it is managed via the Invoices page, not the
  //             expense-entry form.
  source: "diary" | "ledger" | "invoice";
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
  // Null when the form was opened without a project — the nav-bar invoice
  // flow, where the project is chosen on the form itself rather than by the
  // route. Every other field here is already cross-project.
  project: Project | null;
  // Every project the user owns, for that chooser. Always populated, so the
  // in-project flows can offer it too.
  projects: ProjectRef[];
  suppliers: SupplierRef[];
  items: ItemRef[];
  trades: TradeLookup[];
  units: string[]; // units already used, for the unit type-ahead
  // The week to default to, per project — "week 7" means nothing until you
  // know whose week 7. `next_week` is this map read for `project`, kept for
  // the project-scoped callers; it falls back to 1 when there is no project.
  next_week: number;
  next_week_by_project: Record<string, number>;
  invoices: InvoiceRef[];
}

// Just enough of a project to name it in a dropdown.
export interface ProjectRef {
  id: string;
  name: string;
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
  // True when the original photo or PDF is still in Storage behind this
  // invoice, i.e. it was committed from an upload (migration 0010). Only these
  // rows get a clickable invoice number; a hand-typed invoice has no file and a
  // link that opens nothing reads as a bug.
  has_document: boolean;
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
//   needs_triage — arrived from Gmail from a sender whose domain is not in
//                  supplier_domains, so it was held for a human rather than
//                  extracted automatically (migration 0013)
export type InvoiceUploadStatus =
  | "pending"
  | "processing"
  | "extracted"
  | "failed"
  | "committed"
  | "needs_triage";

// 'text'   — the PDF carried a real text layer and we read it
// 'vision' — there was no text layer, so the page images were read instead
export type ExtractionMethod = "text" | "vision";

export interface InvoiceUpload {
  id: string;
  user_id: string;
  // Null until the review screen files this invoice against a project
  // (migration 0012). A 'committed' upload always has one — the database
  // refuses that row otherwise.
  project_id: string | null;
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
  // ---- Gmail provenance (migration 0013) -------------------------------
  // All null on a manually uploaded file, which is every row that existed
  // before 0013. `source_channel` says which of the two this is.
  gmail_message_id: string | null;
  gmail_attachment_id: string | null;
  gmail_thread_id: string | null;
  from_address: string | null;
  subject: string | null;
  received_at: string | null;
  // sha256 of the raw bytes, lower-case hex. This is the dedupe key: the same
  // invoice forwarded or re-sent arrives with a different message id but the
  // same bytes.
  file_hash: string | null;
  source_channel: InvoiceSourceChannel;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Gmail ingestion (migration 0013)
// ============================================================
// Each of these mirrors a CHECK constraint in 0013. Per R4 the database list
// and the constant here change together, always.

// 'manual' — a human chose the file and uploaded it through the nav bar
// 'gmail'  — it was pulled off an email attachment
export const INVOICE_SOURCE_CHANNELS = ["manual", "gmail"] as const;
export type InvoiceSourceChannel = (typeof INVOICE_SOURCE_CHANNELS)[number];

//   active       — credential works, ingestion may run
//   needs_reauth — Google returned invalid_grant; the user must reconnect
//   paused       — the user turned ingestion off deliberately
export const GMAIL_ACCOUNT_STATUSES = [
  "active",
  "needs_reauth",
  "paused",
] as const;
export type GmailAccountStatus = (typeof GMAIL_ACCOUNT_STATUSES)[number];

export const GMAIL_EVENT_STATUSES = [
  "pending",
  "processing",
  "done",
  "failed",
] as const;
export type GmailEventStatus = (typeof GMAIL_EVENT_STATUSES)[number];

// One connected mailbox. Only the refresh token is stored — access tokens are
// minted per call in lib/gmail/auth.ts and never persisted.
export interface GmailAccount {
  id: string;
  user_id: string;
  email_address: string;
  refresh_token: string;
  // Written by phase 2; null after the connect flow alone.
  watch_label_id: string | null;
  // Gmail historyIds exceed int4, so they are text everywhere.
  last_history_id: string | null;
  watch_expiration: string | null;
  last_notification_at: string | null;
  last_drain_at: string | null;
  status: GmailAccountStatus;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// The durable inbox for Pub/Sub push notifications. Delivery is at-least-once,
// so `pubsub_message_id` is unique per user and a redelivery is dropped.
export interface GmailEvent {
  id: string;
  user_id: string;
  account_id: string | null;
  pubsub_message_id: string;
  history_id: string;
  status: GmailEventStatus;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// A sender domain the user has declared as a supplier. Anything arriving from
// a domain that is not listed is held as 'needs_triage' rather than extracted.
export interface SupplierDomain {
  id: string;
  user_id: string;
  supplier_id: string | null;
  domain: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Project view models built from invoice data (purchases + purchase_lines)
// ============================================================
// The week-by-week spreadsheet was removed because too many of its rows had no
// quantity and no unit price, which is exactly what the Price Tracker needs.
// Invoices carry both, so the Trades / Labour / Materials / Suppliers / Price
// Tracker screens are now derived from `purchase_lines` and their parent
// `purchases` rather than from `expense_entries`.
//
// Everything below is computed on read in lib/invoiceViews.ts. None of it is
// stored, and none of it mixes diary and ledger money (about.md §5) — the
// ledger has been empty since migration 0009 and these views simply carry
// whatever entry_source their purchases have.

// One line of one invoice, flattened with everything its header knows. This is
// the row every screen below is built from.
export interface InvoiceLineView {
  line_id: string;
  purchase_id: string;
  project_id: string;
  week_no: number | null;
  date: string | null; // purchases.purchase_date
  invoice_no: string | null;
  supplier_id: string | null;
  supplier: string; // "No supplier" when the header has none
  item_id: string | null;
  // The canonical item name when the line was matched to one, otherwise the
  // description exactly as the document wrote it. Never blank.
  item_name: string;
  description: string; // description_raw, verbatim
  category: ExpenseCategory | null;
  trade: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_net: number; // ex-VAT
  vat_rate: number;
  vat_amount: number;
  line_gross: number; // line_net + vat_amount
  entry_status: ExpenseStatus;
  entry_source: PurchaseEntrySource;
  // Payment is recorded per document, not per line, so a line cannot say what
  // *it* cost you. This is the parent invoice's state, shown as context.
  purchase_status: PurchaseStatus;
}

// One row of the Trades screen: every invoice filed under the same trade.
export interface TradeInvoiceRow {
  trade: string; // "Unassigned" when the invoice names none
  invoice_count: number;
  line_count: number;
  suppliers: string[];
  quoted: number; // Σ quoted_gross, 0 when nothing was quoted
  net: number;
  vat: number;
  gross: number;
  paid: number;
  balance: number; // gross − paid
  status: PurchaseStatus;
  last_date: string | null;
}

// One row of the Suppliers screen, scoped to a single project.
export interface SupplierInvoiceRow {
  supplier_id: string | null;
  supplier: string;
  invoice_count: number;
  line_count: number;
  net: number;
  vat: number;
  gross: number;
  paid: number;
  balance: number;
  status: PurchaseStatus;
  last_date: string | null;
  categories: string[];
}

// One appearance of an item on one invoice, on the Price Tracker's timeline.
export interface ItemPriceRowPoint {
  line_id: string;
  purchase_id: string;
  date: string | null;
  supplier: string;
  invoice_no: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  line_net: number;
  // Null whenever no honest percentage exists — first buy, or the unit
  // changed. Callers must render `move: "unit_change"` as a note about the
  // units, never as a number.
  delta_pct: number | null;
  move: PriceMove;
  previous_unit: string | null;
}

// One item on the Price Tracker: what it cost the first time, what it costs
// now, and every buy in between.
export interface ItemPriceRow {
  item_id: string | null;
  item: string;
  units: string[]; // every unit this item has been bought in
  purchase_count: number;
  total_qty: number;
  total_net: number;
  suppliers: string[];
  first_price: number;
  latest_price: number;
  latest_delta_pct: number | null;
  trend: PriceMove;
  last_date: string | null;
  points: ItemPriceRowPoint[]; // oldest → newest
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
