// Aggregation helpers — the Overview tab's figures, derived from expense entries.
//
// ---------------------------------------------------------------------------
// What is NOT in here any more, and must not come back
// ---------------------------------------------------------------------------
// This file used to carry a second set of builders — `buildTrades`,
// `buildMaterials`, `buildMaterialLedger`, `buildPriceHistory`,
// `buildPriceAlerts` — for the Trades, Materials and Price Tracker screens. They
// were written when every cost was a hand-typed row and they still assumed it:
// they needed `category === "Materials"` to be set, and a per-row `unit_cost` to
// exist. Neither is true of money that arrives as an invoice, where the
// quantity and the unit price live on the document's LINES.
//
// Those screens moved to lib/invoiceViews.ts, which reads purchase lines. The
// old builders stayed behind feeding the Excel and PDF exports and five
// unreachable GET endpoints, so the export disagreed with the app it was
// exported from — a near-empty Materials sheet, a Prices sheet containing one
// row reading "—", and trade totals that did not reconcile with the Analysis
// tab. All of that was deleted on 2026-10-01; the exports now call the same
// builders the screens call. See about.md §6.10 and the header of lib/export.ts.
//
// So: anything grouped by trade, supplier, item or unit price belongs in
// lib/invoiceViews.ts. What is left here is the Overview's own arithmetic —
// the money cards, the weekly chart and the Labour/Materials donut — which is
// over whole cost rows and has no line-level question to answer.

import type {
  ExpenseEntryComputed,
  Project,
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  ProjectWeek,
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
  // Quoted amounts are stored to the penny while the total is derived, so the
  // difference carries sub-penny float noise. Round it, and normalise -0 to 0
  // so an exact match never renders as "-£0.00".
  const variance = Math.round((forecast_total - total_quoted) * 100) / 100 || 0;
  // How much of the cost is backed by an agreed figure. `variance` compares
  // the WHOLE cost against only the rows that carry a quote, so on a project
  // where one job in five was quoted it reports an overrun that is really just
  // the other four jobs existing. The cards use this to decide whether the
  // comparison is worth showing at all — see types/ProjectSummary and
  // committedGross() in lib/purchases.ts for why so many rows have no quote.
  const quoted_cost = active.reduce(
    (s, e) => (Number(e.quoted_amount) > 0 ? s + e.total_incl_vat : s),
    0
  );
  const quoted_coverage = forecast_total > 0 ? quoted_cost / forecast_total : 0;
  const contingency_amount = Math.max(variance, 0);
  const weeks = new Set(active.map((e) => e.week_number));
  return {
    target_budget,
    total_quoted,
    forecast_total,
    variance,
    quoted_coverage,
    contingency_amount,
    forecast_plus_contingency: forecast_total + contingency_amount,
    paid_to_date,
    remaining_to_pay: forecast_total - paid_to_date,
    weeks_tracked: weeks.size,
  };
}

// Which side of the Labour / Materials split a row falls on.
//
// Only an explicit "Labour" counts as labour. Everything else — Materials,
// Skip/Disposal, Other, and rows with no category at all — is materials. That
// matches materialLines() in lib/invoiceViews.ts, so the Overview donut and the
// Materials tab always describe the same money.
//
// The asymmetry is deliberate: category is optional on an invoice and the
// extractor does not set it, so uncategorised rows are the common case, and
// counting them as labour (which is what "Materials or else labour" did) put
// every uploaded invoice in the wrong half of the chart.
const isLabour = (e: ExpenseEntryComputed) => e.category === "Labour";

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
    if (isLabour(e)) row.labour += e.total_incl_vat;
    else row.materials += e.total_incl_vat;
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
    if (isLabour(e)) labour += e.total_incl_vat;
    else materials += e.total_incl_vat;
  }
  return [
    { category: "Labour", total: labour },
    { category: "Materials", total: materials },
  ];
}

// Normalise a description into a price-tracking key.
export function priceKey(description: string): string {
  return description.trim().toLowerCase().replace(/\s+/g, " ");
}
