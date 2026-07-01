// Aggregation helpers — derive dashboard/trades/materials/prices summaries
// from expense entries.

import type {
  ExpenseEntryComputed,
  Project,
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  TradeSummary,
  MaterialSummary,
  MaterialLedgerRow,
  ProjectWeek,
  PriceHistoryItem,
  PricePurchase,
  PriceDirection,
} from "@/types";

const ACTIVE = (e: ExpenseEntryComputed) => e.status !== "Cancelled";

export function buildSummary(
  project: Project,
  entries: ExpenseEntryComputed[]
): ProjectSummary {
  const active = entries.filter(ACTIVE);
  const total_quoted = active.reduce((s, e) => s + Number(e.quoted_amount), 0);
  const forecast_total = active.reduce((s, e) => s + e.total_incl_vat, 0);
  const paid_to_date = active.reduce((s, e) => s + Number(e.paid_amount), 0);
  const target_budget = Number(project.target_budget);
  const variance = forecast_total - total_quoted;
  const contingency_amount = Math.max(variance, 0);
  const weeks = new Set(active.map((e) => e.week_number));
  return {
    target_budget,
    total_quoted,
    forecast_total,
    variance,
    contingency_amount,
    forecast_plus_contingency: forecast_total + contingency_amount,
    paid_to_date,
    remaining_to_pay: forecast_total - paid_to_date,
    weeks_tracked: weeks.size,
  };
}

// Labour vs Materials is now split by category (Materials → materials bucket,
// everything else → labour bucket) using each entry's total incl. VAT.
export function buildByWeek(
  entries: ExpenseEntryComputed[],
  weeks: ProjectWeek[] = []
): WeekTotal[] {
  const map = new Map<number, WeekTotal>();
  const completionByWeek = new Map<number, number>(
    weeks.map((w) => [w.week_number, Number(w.completion_pct)])
  );
  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    const row =
      map.get(e.week_number) ??
      {
        week_number: e.week_number,
        labour: 0,
        materials: 0,
        vat: 0,
        total: 0,
        completion_pct: completionByWeek.get(e.week_number) ?? 0,
      };
    if (e.category === "Materials") row.materials += e.total_incl_vat;
    else row.labour += e.total_incl_vat;
    row.vat += e.vat_amount;
    row.total += e.total_incl_vat;
    map.set(e.week_number, row);
  }
  return [...map.values()].sort((a, b) => a.week_number - b.week_number);
}

export function buildByCategory(entries: ExpenseEntryComputed[]): CategoryTotal[] {
  let labour = 0;
  let materials = 0;
  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    if (e.category === "Materials") materials += e.total_incl_vat;
    else labour += e.total_incl_vat;
  }
  return [
    { category: "Labour", total: labour },
    { category: "Materials", total: materials },
  ];
}

export function buildTrades(entries: ExpenseEntryComputed[]): TradeSummary[] {
  const map = new Map<
    string,
    { quoted: number; actual: number; paid: number }
  >();
  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    const trade = e.trade || "Unassigned";
    const row = map.get(trade) ?? { quoted: 0, actual: 0, paid: 0 };
    row.quoted += Number(e.quoted_amount);
    row.actual += e.total_incl_vat;
    row.paid += Number(e.paid_amount);
    map.set(trade, row);
  }
  return [...map.entries()]
    .map(([trade, { quoted, actual, paid }]) => {
      const remaining = actual - paid;
      let status: TradeSummary["status"] = "Pending";
      if (paid > 0 && remaining <= 0.001) status = "Paid";
      else if (paid > 0) status = "Partial";
      return { trade, quoted, actual, paid, remaining, status };
    })
    .sort((a, b) => b.actual - a.actual);
}

export function buildMaterials(entries: ExpenseEntryComputed[]): MaterialSummary[] {
  const map = new Map<string, MaterialSummary>();
  for (const e of entries) {
    if (e.category !== "Materials" || e.status === "Cancelled") continue;
    const supplier = e.supplier || "Unknown supplier";
    const row =
      map.get(supplier) ??
      {
        supplier,
        cost: 0,
        paid: 0,
        remaining: 0,
        vat: 0,
        total: 0,
        payment_methods: [] as string[],
        entries: 0,
      };
    row.cost += e.total_incl_vat;
    row.paid += Number(e.paid_amount);
    row.remaining = row.cost - row.paid;
    row.vat += e.vat_amount;
    row.total += e.total_incl_vat;
    row.entries += 1;
    if (e.payment_method && !row.payment_methods.includes(e.payment_method)) {
      row.payment_methods.push(e.payment_method);
    }
    map.set(supplier, row);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// Flat per-purchase materials ledger (the "Materials & Suppliers" view).
// Every expense entry with category = Materials shows up here automatically,
// so adding a material in the Expenses form also updates this tab.
export function buildMaterialLedger(
  entries: ExpenseEntryComputed[]
): MaterialLedgerRow[] {
  return entries
    .filter((e) => e.category === "Materials" && e.status !== "Cancelled")
    .map((e) => ({
      id: e.id,
      week_number: e.week_number,
      item: e.description,
      supplier: e.supplier || "—",
      unit_cost: Number(e.unit_cost),
      qty: Number(e.qty),
      total: e.total_incl_vat,
      paid: Number(e.paid_amount),
      remaining: e.remaining,
      paid_date: e.paid_date,
      payment_method: e.payment_method,
      notes: e.notes,
    }))
    .sort(
      (a, b) =>
        a.week_number - b.week_number ||
        (a.paid_date || "").localeCompare(b.paid_date || "")
    );
}

// Normalise a description into a price-tracking key.
export function priceKey(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}

const purchaseDate = (e: ExpenseEntryComputed) => e.paid_date || e.created_at;

// Group material purchases by item and compute unit-price change over time.
export function buildPriceHistory(
  entries: ExpenseEntryComputed[]
): PriceHistoryItem[] {
  const groups = new Map<string, ExpenseEntryComputed[]>();
  for (const e of entries) {
    if (e.status === "Cancelled") continue;
    if (e.category !== "Materials") continue;
    if (Number(e.unit_cost) <= 0) continue;
    const key = priceKey(e.description);
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(e);
    groups.set(key, arr);
  }

  const items: PriceHistoryItem[] = [];
  for (const list of groups.values()) {
    const sorted = list
      .slice()
      .sort(
        (a, b) =>
          new Date(purchaseDate(a)).getTime() -
          new Date(purchaseDate(b)).getTime()
      );

    const purchases: PricePurchase[] = sorted.map((e, i) => {
      const unit_cost = Number(e.unit_cost);
      const prev = i > 0 ? Number(sorted[i - 1].unit_cost) : 0;
      let delta_pct = 0;
      let direction: PriceDirection = "first";
      if (i > 0 && prev > 0) {
        delta_pct = ((unit_cost - prev) / prev) * 100;
        direction =
          Math.abs(delta_pct) < 0.001 ? "same" : delta_pct > 0 ? "up" : "down";
      }
      return {
        date: e.paid_date,
        supplier: e.supplier,
        unit_cost,
        qty: Number(e.qty),
        total: e.total_incl_vat,
        delta_pct,
        direction,
      };
    });

    const last = purchases[purchases.length - 1];
    items.push({
      item: sorted[sorted.length - 1].description.trim(),
      purchase_count: purchases.length,
      first_price: purchases[0].unit_cost,
      latest_price: last.unit_cost,
      latest_delta_pct: last.delta_pct,
      trend: last.direction,
      purchases,
    });
  }

  // Items with the biggest recent increase first.
  return items.sort((a, b) => b.latest_delta_pct - a.latest_delta_pct);
}
