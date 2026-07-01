// Excel export — recreates the spend-tracker sheet structure (Week-by-Week,
// Summary, Trades, Materials, Prices). Uses SheetJS (xlsx).
import * as XLSX from "xlsx";
import type {
  Project,
  ExpenseEntryComputed,
  ProjectSummary,
  TradeSummary,
  MaterialSummary,
  PriceHistoryItem,
} from "@/types";

const money = (n: number) => Number(n.toFixed(2));

export function buildWorkbook(
  project: Project,
  entries: ExpenseEntryComputed[],
  summary: ProjectSummary,
  trades: TradeSummary[],
  materials: MaterialSummary[],
  prices: PriceHistoryItem[] = []
): ArrayBuffer {
  const wb = XLSX.utils.book_new();

  // Week-by-Week
  const weekRows = entries
    .slice()
    .sort((a, b) => a.week_number - b.week_number)
    .map((e) => ({
      Week: e.week_number,
      Description: e.description,
      Category: e.category ?? "",
      Trade: e.trade ?? "",
      "Location/Room": e.location_room ?? "",
      Supplier: e.supplier ?? "",
      Quoted: money(Number(e.quoted_amount)),
      Actual: money(Number(e.actual_amount)),
      Paid: money(Number(e.paid_amount)),
      Remaining: money(e.remaining),
      Qty: money(e.qty),
      "Unit Cost": money(e.unit_cost),
      "VAT %": e.vat_rate,
      "VAT Amount": money(e.vat_amount),
      "Total incl. VAT": money(e.total_incl_vat),
      Status: e.status,
      "Payment Method": e.payment_method ?? "",
      "Date Paid": e.paid_date ?? "",
      "Invoice Ref": e.invoice_ref ?? "",
    }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(weekRows),
    "Week-by-Week"
  );

  // Summary
  const summaryRows = [
    { Metric: "Project", Value: project.name },
    { Metric: "Status", Value: project.status },
    { Metric: "Target Budget", Value: money(summary.target_budget) },
    { Metric: "Total Quoted", Value: money(summary.total_quoted) },
    { Metric: "Actual Total", Value: money(summary.forecast_total) },
    { Metric: "Variance vs Quote", Value: money(summary.variance) },
    { Metric: "Paid to Date", Value: money(summary.paid_to_date) },
    { Metric: "Remaining to Pay", Value: money(summary.remaining_to_pay) },
    { Metric: "Weeks Tracked", Value: summary.weeks_tracked },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows),
    "Summary"
  );

  // Trades & Labour
  const tradeRows = trades.map((t) => ({
    Trade: t.trade,
    Quoted: money(t.quoted),
    Actual: money(t.actual),
    Paid: money(t.paid),
    Remaining: money(t.remaining),
    Status: t.status,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(tradeRows.length ? tradeRows : [{ Trade: "—" }]),
    "Trades & Labour"
  );

  // Materials & Suppliers
  const materialRows = materials.map((m) => ({
    Supplier: m.supplier,
    Cost: money(m.cost),
    Paid: money(m.paid),
    Remaining: money(m.remaining),
    VAT: money(m.vat),
    Total: money(m.total),
    "Payment Methods": m.payment_methods.join(", "),
    Entries: m.entries,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      materialRows.length ? materialRows : [{ Supplier: "—" }]
    ),
    "Materials & Suppliers"
  );

  // Prices — one row per dated purchase, so the unit-price trend is visible.
  const priceRows = prices.flatMap((it) =>
    it.purchases.map((p) => ({
      Item: it.item,
      Date: p.date ?? "",
      Supplier: p.supplier ?? "",
      "Unit Cost": money(p.unit_cost),
      Qty: money(p.qty),
      Total: money(p.total),
      "Change vs Prev %":
        p.direction === "first" ? "" : money(p.delta_pct),
    }))
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(priceRows.length ? priceRows : [{ Item: "—" }]),
    "Prices"
  );

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
