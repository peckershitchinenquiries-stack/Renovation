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
  // ---- the schedule's calendar anchor (migrations 0016 and 0018) ----
  // Both were in 0001, dropped by 0002 because nobody tracked them, and came
  // back with the schedule. Nullable: an unanchored project simply shows no
  // dates against its weeks, exactly as it did before.
  start_date: string | null;
  planned_end_date: string | null;
  // ISO weekday numbers — 1 = Monday … 7 = Sunday. Defaults to Mon–Fri. The
  // scheduling engine counts working days, so this is what makes a task that
  // starts on a Friday and lasts three days finish on the Tuesday.
  working_weekdays: number[];
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
  // The hand-entered half of the money↔work join (migration 0017). A flat
  // expense row is its own line, so the same line-level rule applies.
  task_id: string | null;
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
  // ---- retention (migration 0019) ----
  // The percentage held back from a contractor until the defects period is
  // up. NULL, not 0, on every row that predates the feature — "no retention
  // on this invoice" is a different statement from "0% was held", and it is
  // what keeps every existing figure identical to the penny.
  retention_pct: number | null;
  retention_release_due: string | null;
  // Non-null means it is no longer held, so the money goes back into Owed.
  retention_released_on: string | null;
  // Which order this invoice answers (migration 0023). Null on everything
  // that was not raised as a PO first, which today is everything.
  purchase_order_id: string | null;
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
  // The join between the money half of the app and the schedule half
  // (migration 0017). Line level is authoritative: a task's actual cost is the
  // sum of the LINES tagged to it, never of whole documents, so there is one
  // place to sum from and it cannot double-count.
  task_id: string | null;
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
  // ---- retention (migration 0019), all derived and none of it stored ----
  /** gross_total × retention_pct ÷ 100. Zero whenever no retention applies. */
  retention_amount: number;
  /** Still held: `retention_amount` until it is released, then 0. */
  retention_held: number;
  /** gross_total − retention_held — what is actually chaseable today. */
  payable_now: number;
  /**
   * payable_now − paid.
   *
   * This is the one existing formula retention changes. With `retention_pct`
   * null — every row before 0019 — `retention_held` is 0, `payable_now` is
   * `gross_total`, and this is `gross_total − paid` exactly as it always was.
   * A retention is NOT an unpaid bill and must never read as one; keeping it
   * out of here is the whole of the feature.
   */
  balance: number;
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
  /**
   * Σ retention still held (migration 0019). Reported BESIDE Owed, never
   * inside it: a retention is money you agreed to hold, not a bill you are
   * late paying, and adding the two back together undoes the feature.
   */
  retention_held: number;
  balance: number; // payable_now − paid
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

/** Just enough of a task to name it in a picker, with its phase for context. */
export interface TaskRef {
  id: string;
  name: string;
  phase_name: string | null;
  status: TaskStatus;
}

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
  // Which piece of work this line paid for (migration 0017). Line level is
  // authoritative: the form's "apply to all lines" control writes this same
  // field on every line rather than tagging the document, so there is one
  // place a per-task total can be summed from.
  task_id?: string | null;
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
  // ---- retention (migration 0019) ----
  // Blank means no retention, which is what almost every invoice says. The
  // form only shows the two dates once a percentage has been typed.
  retention_pct?: number | string | null;
  retention_release_due?: string | null;
  retention_released_on?: string | null;
  // Which order this invoice answers (migration 0023).
  purchase_order_id?: string | null;
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
  // Tasks per project, for the line-level task picker. Keyed by project for
  // the same reason `next_week_by_project` is: the nav-bar invoice flow lets
  // the project be changed on the form, and a task list from the wrong project
  // is worse than none.
  tasks_by_project: Record<string, TaskRef[]>;
  /**
   * Open purchase orders per project (migration 0023), for the "which order
   * is this?" picker.
   *
   * Keyed by project for the same reason the two above are: the nav-bar
   * invoice flow lets the project be changed on the form, and an order list
   * from the wrong job is worse than none.
   */
  orders_by_project: Record<string, PurchaseOrderRef[]>;
}

/** Just enough of an order to recognise it in a picker. */
export interface PurchaseOrderRef {
  id: string;
  po_number: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  raised_on: string;
  status: PoStatus;
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
  // Which piece of work this line paid for (migration 0017). Null on every
  // line until somebody tags it, which is why every screen that reports per
  // task also reports the untagged total — see lib/scheduleCosts.ts.
  task_id: string | null;
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

// ============================================================
// The schedule (migrations 0016–0018) — phases, tasks, dependencies,
// baselines and the revision log.
// ============================================================
// This is the second half of the application: the first half tracks money,
// this one tracks time, and `task_id` on a purchase line is the whole of the
// join between them.
//
// The rule that governs everything below, stated once (about.md §15):
// `duration_days` is AUTHORITATIVE and the planned dates are derived from it
// plus the dependency constraints — except for a task with no predecessors,
// where `planned_start` is the anchor. Setting a date on a task that has
// predecessors is an anchor, not a fact: the scheduler may move it.

export const TASK_STATUSES = [
  "Not started",
  "In progress",
  "Blocked",
  "Complete",
  "Cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

// Deliberately NOT ExpenseStatus. A task is not a payment: 'Paid' is
// meaningless for a piece of work, and 'In Progress' means a different thing
// on each. Two lists, mirroring two separate CHECK constraints.

export const DEP_TYPES = ["FS", "SS", "FF", "SF"] as const;
export type DepType = (typeof DEP_TYPES)[number];

/** What each dependency type actually constrains, for the picker's hint line. */
export const DEP_TYPE_LABELS: Record<DepType, string> = {
  FS: "Finish → start",
  SS: "Start → start",
  FF: "Finish → finish",
  SF: "Start → finish",
};

export const REASON_CODES = [
  "material_delay",
  "weather",
  "client_change",
  "trade_no_show",
  "scope_change",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_CODE_LABELS: Record<ReasonCode, string> = {
  material_delay: "Material delay",
  weather: "Weather",
  client_change: "Client change",
  trade_no_show: "Trade no-show",
  scope_change: "Scope change",
  other: "Other",
};

// 'manual'   — a person changed this task themselves
// 'knock_on' — the scheduler moved it because something upstream moved
export const SHIFT_SOURCES = ["manual", "knock_on"] as const;
export type ShiftSource = (typeof SHIFT_SOURCES)[number];

export const PHASE_COLOURS = [
  "slate",
  "emerald",
  "amber",
  "blue",
  "violet",
  "rose",
  "teal",
  "orange",
] as const;
export type PhaseColour = (typeof PHASE_COLOURS)[number];

export interface ProjectPhase {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  sort_order: number;
  colour: PhaseColour | null;
  // The phase's own target. Its ACTUAL dates are min/max over its tasks and
  // are derived on read (phaseActualDates) — never stored.
  target_start: string | null;
  target_end: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  project_id: string;
  phase_id: string | null;
  name: string;
  // Free text matched against trade_lookups.name by convention only — no FK,
  // exactly like purchases.trade.
  trade: string | null;
  // Reserved by 0016; gets its foreign key to `contacts` in Phase 5.
  assignee_contact_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  duration_days: number | null;
  // Hand-entered. The cost-based figure is shown beside it, never instead.
  progress_pct: number;
  status: TaskStatus;
  // EX-VAT, to match line_net. Compared against net cost, never gross.
  budget_amount: number | null;
  weather_sensitive: boolean;
  lead_time_days: number | null;
  // A time-based hire (scaffold), for the cost impact of a delay.
  hire_daily_rate: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  id: string;
  user_id: string;
  project_id: string;
  predecessor_id: string;
  successor_id: string;
  dep_type: DepType;
  // Negative is a lead, which is ordinary on a renovation.
  lag_days: number;
  /**
   * The predecessor must be SIGNED OFF, not merely finished (migration 0020).
   *
   * This is the spec's own example — "the plasterer can't start until first
   * fix is signed off" — and it is a different constraint from a finish date.
   * A finished-but-unsigned predecessor leaves the successor `is_blocked`.
   */
  requires_signoff: boolean;
  created_at: string;
}

export interface TaskBaseline {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string;
  baseline_name: string;
  planned_start: string | null;
  planned_end: string | null;
  duration_days: number | null;
  // The budget is baselined too — otherwise "budget drift" has nothing to
  // drift from.
  budget_amount: number | null;
  captured_at: string;
  captured_by: string | null;
}

export interface TaskRevision {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string;
  changed_at: string;
  changed_by: string | null;
  field: string;
  // Text, not typed values: this is a log, not a calculation input.
  old_value: string | null;
  new_value: string | null;
  reason_code: ReasonCode | null;
  reason_note: string | null;
  shift_source: ShiftSource;
}

export interface ProjectHoliday {
  id: string;
  user_id: string;
  project_id: string;
  holiday_date: string;
  name: string | null;
  created_at: string;
}

/**
 * Which days count as working days.
 *
 * `working_weekdays` is ISO numbering — 1 = Monday … 7 = Sunday — the same
 * convention the database column uses. Holidays are ISO date strings.
 */
export interface WorkCalendar {
  working_weekdays: number[];
  holidays: string[];
}

// `DEFAULT_WORK_CALENDAR` deliberately lives in lib/schedule.ts, not here.
// That module is covered by lib/schedule.test.mts, which runs under
// `node --experimental-strip-types`: type-only imports are erased, but a
// runtime import of a `const` from "@/types" would have to resolve the path
// alias, which the bare Node runner cannot do. Keeping the engine's one
// runtime constant beside the engine is what keeps it testable.

// ---- computed read models (lib/schedule.ts) — none of this is stored ----

/**
 * One task with everything the scheduler worked out about it.
 *
 * `early_*` / `late_*` are the classic forward/backward pass results. Float is
 * in WORKING days, not calendar days: "four days of slack" over a weekend
 * means four days someone could actually be on site.
 */
export interface ScheduledTask extends Task {
  // What the engine computed, which may differ from planned_start/end when a
  // dependency constrains the task. These are what the Gantt draws.
  computed_start: string | null;
  computed_end: string | null;
  early_start: string | null;
  early_finish: string | null;
  late_start: string | null;
  late_finish: string | null;
  // late_start − early_start, in working days. Null when the task has no
  // dates to compute from.
  total_float: number | null;
  free_float: number | null;
  is_critical: boolean;
  // True when a predecessor is not yet complete — the difference between
  // "could start today" and "waiting on someone".
  is_blocked: boolean;
  /**
   * WHY it is blocked, so the badge can say so (migration 0020).
   *
   * 'predecessor' — something upstream is not finished.
   * 'signoff'     — everything upstream IS finished, but a link that requires
   *                 sign-off has not been signed. That is a different problem
   *                 with a different fix, and a badge saying only "Blocked"
   *                 sends somebody to chase the wrong person.
   */
  blocked_reason: "predecessor" | "signoff" | null;
  /** The latest sign-off on this task, if any. Null means never signed. */
  signoff: TaskSignoff | null;
  predecessor_ids: string[];
  successor_ids: string[];
  // Days late (positive) or early (negative) against the captured baseline.
  // Null when no baseline exists for this task.
  drift_start_days: number | null;
  drift_end_days: number | null;
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  // The latest computed finish across every task. Null when nothing is dated.
  completion: string | null;
  baseline_completion: string | null;
  // completion vs baseline_completion, in working days. Positive is late.
  completion_drift_days: number | null;
  // Named as a path when one exists, so the header can say what is driving it.
  critical_task_ids: string[];
  // A dependency loop, if the stored graph contains one. The engine refuses to
  // schedule rather than looping for ever, and the UI says which tasks.
  cycle: string[] | null;
}

/** Everything the Schedule tab reads, in one server pass. */
export interface ScheduleBundle {
  project: Project;
  phases: ProjectPhase[];
  tasks: Task[];
  dependencies: TaskDependency[];
  // The current baseline set only — the newest `baseline_name` captured.
  baseline: TaskBaseline[];
  baseline_name: string | null;
  revisions: TaskRevision[];
  // Every sign-off on this project, newest first (migration 0020). The engine
  // needs them to answer `requires_signoff` links; the UI needs them to show
  // who signed what.
  signoffs: TaskSignoff[];
  calendar: WorkCalendar;
}

// ---- Phase 2: cost tied to the schedule (lib/scheduleCosts.ts) ----

/**
 * Budget vs money, per task. All EX-VAT on the budget side and labelled as
 * such on screen: `budget_amount` is ex-VAT to match `line_net`, and comparing
 * it against an incl-VAT cost is the double-VAT error this codebase has
 * already made once.
 */
export interface TaskCostRow {
  task_id: string;
  task_name: string;
  phase_id: string | null;
  budget: number; // ex-VAT target, 0 when none set
  committed: number; // Σ quoted_gross of the documents touching this task
  net: number; // ex-VAT actual — the figure `budget` is comparable with
  gross: number; // incl-VAT actual, for the money columns
  paid: number;
  owed: number; // gross − paid
  variance: number; // net − budget. Positive is over.
  variance_pct: number | null; // null when there is no budget to compare to
  line_count: number;
}

/** The same, rolled up per phase, plus the bucket everything untagged lands in. */
export interface PhaseCostRow extends Omit<TaskCostRow, "task_id" | "task_name"> {
  phase_id: string | null;
  phase_name: string;
  task_count: number;
}

/**
 * The project total — and the untagged figure, which is the whole reason this
 * type exists. A project can look perfectly on budget because half its spend
 * is invisible to the roll-up; one number on screen is the counter to that.
 */
export interface ProjectCostRollup {
  budget: number;
  net: number;
  gross: number;
  paid: number;
  owed: number;
  variance: number;
  tagged_line_count: number;
  untagged_line_count: number;
  untagged_net: number;
  untagged_gross: number;
}

/**
 * What extending a task by N days is likely to cost.
 *
 * It only claims what it can evidence. `basis` says which rate was used, and
 * when there is no rate on file the chip says so rather than showing £0 —
 * a delay that reads as free is worse than no estimate at all.
 */
export interface CostImpact {
  days: number;
  hire_cost: number;
  labour_cost: number;
  total: number;
  // Human-readable working, e.g. "scaffold £60/day × 3" — shown on the chip.
  basis: string[];
  // True when nothing on file could price this delay.
  unpriced: boolean;
}

// ---- Phase 8: portfolio reporting (lib/portfolio.ts) ----

/**
 * How one project is doing, on the two axes that matter.
 *
 * There are TWO percentages and both are named, always. `pct_complete` is the
 * duration-weighted mean of hand-entered task progress; `pct_cost` is spend
 * against budget. Showing one number that silently means the other is the
 * classic renovation reporting error.
 */
export interface ProjectHealth {
  project_id: string;
  project_name: string;
  status: ProjectStatus;
  pct_complete: number;
  pct_cost: number | null; // null when nothing is budgeted
  // Positive = behind. Working days, against the baseline where one exists.
  days_variance: number | null;
  // Which yardstick days_variance used, so the screen can say so.
  variance_basis: "baseline" | "planned_end_date" | "none";
  completion: string | null;
  budget: number;
  cost: number;
  budget_variance: number;
  task_count: number;
  critical_count: number;
  // Tasks whose order-by date (planned_start − lead_time_days) is within the
  // next fortnight — how joinery and windows slip.
  order_soon_count: number;
}

// ---- write models — what the forms send ----

export interface TaskInput {
  phase_id?: string | null;
  name: string;
  trade?: string | null;
  /** Who is doing it (migration 0020). Blank means nobody yet. */
  assignee_contact_id?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  duration_days?: number | string | null;
  progress_pct?: number | string;
  status: TaskStatus;
  budget_amount?: number | string | null;
  weather_sensitive?: boolean;
  lead_time_days?: number | string | null;
  hire_daily_rate?: number | string | null;
  notes?: string | null;
  sort_order?: number | string;
  // Required by the API when a dated field moves on a task that has a
  // baseline — the log is worthless if it is optional.
  reason_code?: ReasonCode | "" | null;
  reason_note?: string | null;
}

export interface PhaseInput {
  name: string;
  sort_order?: number | string;
  colour?: PhaseColour | "" | null;
  target_start?: string | null;
  target_end?: string | null;
  notes?: string | null;
}

export interface DependencyInput {
  predecessor_id: string;
  successor_id: string;
  dep_type: DepType;
  lag_days?: number | string;
  requires_signoff?: boolean;
}

/**
 * One task moved, and what it does to everything downstream.
 *
 * The same request shape is sent twice — once with `confirm: false` for the
 * preview and once with `confirm: true` to save — so the preview can never
 * disagree with what actually gets written.
 */
export interface ShiftRequest {
  task_id: string;
  planned_start: string | null;
  planned_end: string | null;
  duration_days?: number | string | null;
  reason_code?: ReasonCode | "" | null;
  reason_note?: string | null;
  confirm: boolean;
}

/** One task the auto-shift would move, as shown in the confirm dialog. */
export interface ShiftPreviewRow {
  task_id: string;
  task_name: string;
  from_start: string | null;
  to_start: string | null;
  from_end: string | null;
  to_end: string | null;
  days: number;
  // False for the task the user actually edited; true for everything the
  // scheduler moved as a consequence. Written to task_revisions as
  // shift_source = 'knock_on'.
  knock_on: boolean;
}

export interface ShiftPreview {
  rows: ShiftPreviewRow[];
  completion_before: string | null;
  completion_after: string | null;
  completion_days: number;
  cost_impact: CostImpact;
  // True when ANY task this move touches — the edited one or a knock-on — is in
  // the current baseline, and a reason code is therefore compulsory to save.
  // Computed by the server and read by the dialog, so the field the user is
  // shown and the rule the handler enforces can never disagree.
  needs_reason: boolean;
  // Populated when the edit would create a dependency loop. Nothing is saved.
  cycle: string[] | null;
}

// ============================================================
// Track B — people, documents, communication and the money gaps
// (migrations 0019–0024)
// ============================================================
// Independent of the schedule chain: none of this is needed to draw a Gantt,
// and the Gantt is not needed to use any of it. Each const array below mirrors
// a CHECK constraint, and the two change together, always (about.md §2 rule 4).

// ---- Phase 5: people & trades (0020) ----

export const CONTACT_STATUSES = ["active", "inactive"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CERTIFICATION_KINDS = [
  "Public liability",
  "Employers liability",
  "Gas Safe",
  "NICEIC",
  "Part P",
  "CSCS",
  "Other",
] as const;
export type CertificationKind = (typeof CERTIFICATION_KINDS)[number];

export const SIGNOFF_OUTCOMES = [
  "approved",
  "rejected",
  "approved_with_snags",
] as const;
export type SignoffOutcome = (typeof SIGNOFF_OUTCOMES)[number];

export const SIGNOFF_OUTCOME_LABELS: Record<SignoffOutcome, string> = {
  approved: "Approved",
  rejected: "Rejected",
  approved_with_snags: "Approved with snags",
};

/**
 * A person — a subcontractor, a tradesman, an architect.
 *
 * NOT a supplier. Labour is logged against a person's name on a purchase line
 * with no supplier row created (about.md §6.6.1); putting Dave Builder in
 * `suppliers` would put him on the merchant screen with a trade account.
 * `supplier_id` is the optional bridge for the one real overlap — somebody who
 * also invoices as a limited company.
 */
export interface Contact {
  id: string;
  user_id: string;
  name: string;
  company: string | null;
  // A person does more than one trade. Matched against trade_lookups.name by
  // convention only, exactly like tasks.trade — no foreign key.
  trades: string[];
  phone: string | null;
  email: string | null;
  address: string | null;
  day_rate: number | null;
  hourly_rate: number | null;
  supplier_id: string | null;
  status: ContactStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactCertification {
  id: string;
  user_id: string;
  contact_id: string;
  kind: CertificationKind;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  // The scan, once one is uploaded (0021).
  document_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Whether a certificate is any good today. Derived on read in
 * lib/certifications.ts, never stored — a stored "expired" flag is wrong the
 * morning after it is written.
 */
export type ExpiryState = "valid" | "expiring_soon" | "expired" | "unknown";

export interface CertificationView extends ContactCertification {
  state: ExpiryState;
  /** Negative once it has expired. Null when there is no expiry date. */
  days_remaining: number | null;
  contact_id: string;
  contact_name: string;
}

/**
 * Who said a stage was done, and when.
 *
 * It RECORDS and enforces nothing. This workspace has no roles: since 0015,
 * signing in is the entire authorisation model (about.md §9.1). The name of
 * the feature implies otherwise, so it is said here, in the migration, and on
 * the screen.
 */
export interface TaskSignoff {
  id: string;
  user_id: string;
  project_id: string;
  task_id: string;
  signed_by: string | null;
  signed_at: string;
  outcome: SignoffOutcome;
  note: string | null;
}

/** One person, with everything hanging off them. */
export interface ContactBundle {
  contact: Contact;
  certifications: CertificationView[];
  supplier_name: string | null;
  // Work assigned to them, across every project.
  tasks: { task: Task; project_id: string; project_name: string | null }[];
  /**
   * Labour paid to this person. Matched on the NAME written on the invoice
   * line, because that is how labour has always been recorded (about.md
   * §6.6.1) and nothing retro-tags the history. Shown with that caveat.
   */
  labour_net: number;
  labour_line_count: number;
}

export interface ContactListRow {
  contact: Contact;
  task_count: number;
  /** The worst state across their certificates — what the row's chip shows. */
  worst_state: ExpiryState;
  expiring_count: number;
  expired_count: number;
}

export interface ContactInput {
  name: string;
  company?: string | null;
  trades?: string[];
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  day_rate?: number | string | null;
  hourly_rate?: number | string | null;
  supplier_id?: string | null;
  status?: ContactStatus;
  notes?: string | null;
}

export interface CertificationInput {
  kind: CertificationKind;
  reference?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  document_id?: string | null;
  notes?: string | null;
}

export interface SignoffInput {
  outcome: SignoffOutcome;
  note?: string | null;
}

// ---- Phase 6: documents & photos (0021) ----

export const DOC_TYPES = [
  "planning",
  "building_control",
  "warranty",
  "certificate",
  "drawing",
  "spec",
  "contract",
  "photo",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  planning: "Planning",
  building_control: "Building control",
  warranty: "Warranty",
  certificate: "Certificate",
  drawing: "Drawing",
  spec: "Spec",
  contract: "Contract",
  photo: "Photo",
  other: "Other",
};

export interface ProjectDocument {
  id: string;
  user_id: string;
  // Nullable: a company insurance certificate is not one project's.
  project_id: string | null;
  doc_type: DocType;
  title: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  issued_on: string | null;
  expires_on: string | null;
  reference: string | null;
  phase_id: string | null;
  task_id: string | null;
  contact_id: string | null;
  snag_id: string | null;
  // The CAPTURE date, distinct from the upload date — a photo's real position
  // on the timeline.
  taken_at: string | null;
  location_room: string | null;
  version_no: number;
  supersedes_id: string | null;
  /**
   * The one derived value this codebase stores on purpose (about.md §19).
   * Maintained by a trigger in 0021, never by application code, so it cannot
   * drift from the chain it describes.
   */
  is_current: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentView extends ProjectDocument {
  state: ExpiryState;
  days_remaining: number | null;
  phase_name: string | null;
  task_name: string | null;
  contact_name: string | null;
  /** How many versions exist in this document's chain, including itself. */
  version_count: number;
}

export interface DocumentBundle {
  project: Project;
  documents: DocumentView[];
  phases: { id: string; name: string }[];
  tasks: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
}

export interface DocumentInput {
  project_id?: string | null;
  doc_type: DocType;
  title: string;
  issued_on?: string | null;
  expires_on?: string | null;
  reference?: string | null;
  phase_id?: string | null;
  task_id?: string | null;
  contact_id?: string | null;
  snag_id?: string | null;
  taken_at?: string | null;
  location_room?: string | null;
  notes?: string | null;
  /** Set when this upload is a new revision of an existing document. */
  supersedes_id?: string | null;
}

// ---- Phase 7: communication (0022) ----

export const ACTIVITY_KINDS = [
  "call",
  "site_visit",
  "decision",
  "email",
  "meeting",
  "note",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  call: "Call",
  site_visit: "Site visit",
  decision: "Decision",
  email: "Email",
  meeting: "Meeting",
  note: "Note",
};

export interface ActivityEntry {
  id: string;
  user_id: string;
  project_id: string;
  // When it HAPPENED, not when it was typed.
  occurred_at: string;
  kind: ActivityKind;
  summary: string;
  detail: string | null;
  contact_id: string | null;
  task_id: string | null;
  phase_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ActivityView extends ActivityEntry {
  contact_name: string | null;
  task_name: string | null;
  phase_name: string | null;
}

export interface ActivityInput {
  occurred_at?: string | null;
  kind: ActivityKind;
  summary: string;
  detail?: string | null;
  contact_id?: string | null;
  task_id?: string | null;
  phase_id?: string | null;
}

export const SNAG_STATUSES = ["open", "fixed", "verified", "wont_fix"] as const;
export type SnagStatus = (typeof SNAG_STATUSES)[number];

export const SNAG_STATUS_LABELS: Record<SnagStatus, string> = {
  open: "Open",
  fixed: "Fixed",
  verified: "Verified",
  wont_fix: "Won't fix",
};

export const SNAG_SEVERITIES = ["minor", "major", "safety"] as const;
export type SnagSeverity = (typeof SNAG_SEVERITIES)[number];

export const SNAG_SEVERITY_LABELS: Record<SnagSeverity, string> = {
  minor: "Minor",
  major: "Major",
  safety: "Safety",
};

export interface Snag {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  description: string | null;
  location_room: string | null;
  phase_id: string | null;
  task_id: string | null;
  // Who is responsible for putting it right.
  contact_id: string | null;
  status: SnagStatus;
  severity: SnagSeverity;
  raised_on: string;
  fixed_on: string | null;
  verified_on: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SnagView extends Snag {
  contact_name: string | null;
  task_name: string | null;
  phase_name: string | null;
  photos: ProjectDocument[];
}

export interface SnagInput {
  title: string;
  description?: string | null;
  location_room?: string | null;
  phase_id?: string | null;
  task_id?: string | null;
  contact_id?: string | null;
  status: SnagStatus;
  severity: SnagSeverity;
  raised_on?: string | null;
  fixed_on?: string | null;
  verified_on?: string | null;
}

/** Everything the Log screen reads, in one server pass. */
export interface CommunicationBundle {
  project: Project;
  activity: ActivityView[];
  snags: SnagView[];
  phases: { id: string; name: string }[];
  tasks: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
}

// ---- Track B / B3: purchase orders (0023) ----

export const PO_STATUSES = [
  "draft",
  "sent",
  "part_received",
  "received",
  "cancelled",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABELS: Record<PoStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  part_received: "Part received",
  received: "Received",
  cancelled: "Cancelled",
};

/**
 * An order you raised — an intention, not money.
 *
 * Nothing here feeds Committed, Cost, Paid or Owed. Only the invoice that
 * follows is spend, and `purchases.purchase_order_id` is how the two are
 * matched so over-delivery and price creep are visible.
 */
export interface PurchaseOrder {
  id: string;
  user_id: string;
  project_id: string;
  supplier_id: string | null;
  po_number: string | null;
  raised_on: string;
  expected_delivery: string | null;
  status: PoStatus;
  task_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseOrderLine {
  id: string;
  user_id: string;
  po_id: string;
  line_no: number;
  item_id: string | null;
  description: string;
  qty_ordered: number;
  qty_received: number;
  unit: string | null;
  unit_price: number;
  vat_rate: number;
  created_at: string;
  updated_at: string;
}

/** One line, with its arithmetic. Nothing below is a column. */
export interface PurchaseOrderLineView extends PurchaseOrderLine {
  line_net: number; // qty_ordered × unit_price
  line_vat: number;
  line_gross: number;
  qty_outstanding: number; // ordered − received, floored at 0
  over_delivered: boolean; // received > ordered
}

export interface PurchaseOrderView extends PurchaseOrder {
  supplier_name: string | null;
  task_name: string | null;
  lines: PurchaseOrderLineView[];
  net: number;
  vat: number;
  gross: number;
  line_count: number;
  /** True when every line has had at least its ordered quantity delivered. */
  fully_received: boolean;
  /** Invoices matched back to this order. */
  invoice_count: number;
  invoiced_net: number;
  /**
   * invoiced_net − net. Positive means the invoices came to more than the
   * order did, which is the number this whole table exists to surface.
   */
  price_variance: number | null;
}

export interface PurchaseOrderLineInput {
  id?: string | null;
  item_id?: string | null;
  description: string;
  qty_ordered: number | string;
  qty_received?: number | string;
  unit?: string | null;
  unit_price: number | string;
  vat_rate: number | string;
}

export interface PurchaseOrderInput {
  supplier_name?: string | null;
  po_number?: string | null;
  raised_on?: string | null;
  expected_delivery?: string | null;
  status: PoStatus;
  task_id?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLineInput[];
}

// ---- Track B / B4: variations (0024) ----

export const VARIATION_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type VariationStatus = (typeof VARIATION_STATUSES)[number];

export const VARIATION_STATUS_LABELS: Record<VariationStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/**
 * A change to the job: what changed, why, what it cost and what it did to the
 * programme.
 *
 * `cost_impact` and `days_impact` are SIGNED and hand-entered — they are the
 * agreement made at the time, not a derivation. A variation can be an
 * omission, and a table that can only record additions overstates the job.
 */
export interface Variation {
  id: string;
  user_id: string;
  project_id: string;
  ref: string | null;
  title: string;
  description: string | null;
  requested_by: string | null;
  raised_on: string;
  status: VariationStatus;
  approved_on: string | null;
  approved_by: string | null;
  cost_impact: number | null;
  days_impact: number | null;
  task_id: string | null;
  phase_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface VariationView extends Variation {
  task_name: string | null;
  phase_name: string | null;
  /**
   * What the linked task has ACTUALLY cost since, ex-VAT, from the lines
   * tagged to it. Shown beside `cost_impact` and never instead of it: one is
   * what was agreed, the other is what happened, and conflating them is how a
   * variations log stops being evidence.
   */
  task_actual_net: number | null;
  /** Days the linked task has drifted against its baseline. */
  task_drift_days: number | null;
}

/** The project's variation position — approved only, plus what is pending. */
export interface VariationRollup {
  approved_cost: number;
  approved_days: number;
  proposed_cost: number;
  proposed_days: number;
  approved_count: number;
  proposed_count: number;
}

export interface VariationInput {
  ref?: string | null;
  title: string;
  description?: string | null;
  requested_by?: string | null;
  raised_on?: string | null;
  status: VariationStatus;
  approved_on?: string | null;
  cost_impact?: number | string | null;
  days_impact?: number | string | null;
  task_id?: string | null;
  phase_id?: string | null;
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
