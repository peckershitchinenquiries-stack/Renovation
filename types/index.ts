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
  remaining: number; // actual_amount − paid_amount
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

export const VAT_RATES = [0, 20] as const;
