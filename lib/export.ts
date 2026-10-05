// Excel export — the whole project as one workbook, using SheetJS (xlsx).
//
// ---------------------------------------------------------------------------
// The export reads the same builders the screens read
// ---------------------------------------------------------------------------
// Every sheet below is produced by the function that produces the screen it is
// named after, and nothing here has a builder of its own. That is a rule, not a
// coincidence, and it is the fix for a real failure:
//
// Until 2026-10-01 the Trades, Materials and Prices sheets were built by a
// second set of functions in lib/summary.ts that still assumed money arrives as
// hand-typed expense rows. On a project whose money arrives as invoices:
//
//   • the Materials sheet needed `category === "Materials"`, which the invoice
//     extractor never sets, so it came out almost empty;
//   • the Prices sheet needed a per-row `unit_cost`, which an invoice-derived
//     row does not have (the price lives on its LINES), so it was always
//     literally one row reading "—";
//   • the Trades sheet grouped whole documents by trade with a different rule
//     from the Analysis tab, so its totals did not reconcile with the screen
//     they were printed from.
//
// Blank sheets handed to an accountant read as data loss, and a trades total
// that does not match the screen reads as either the export lying or the screen
// lying. Neither is recoverable by the reader. See about.md §6.10.
//
// ---------------------------------------------------------------------------
// Which rows each sheet covers
// ---------------------------------------------------------------------------
// The app itself answers two different questions and the workbook keeps them
// apart the same way, because adding them would double-count:
//
//   • **Week-by-Week / Summary** — every cost row on the project, hand-typed
//     and invoice-derived alike. This is the Costs tab and the Overview cards.
//   • **Trades / Suppliers / Materials / Labour / Prices** — invoice lines
//     only, which is what the Analysis tab reports and the only place a
//     quantity and a unit price exist at all (see lib/invoiceViews.ts).
//
// Ledger rows are excluded from every sheet, exactly as every screen excludes
// them (about.md §5). The caller does that filtering.
import * as XLSX from "xlsx";
import type {
  Project,
  ExpenseEntryComputed,
  ProjectSummary,
  TradeInvoiceRow,
  SupplierInvoiceRow,
  InvoiceLineView,
  ItemPriceRow,
} from "@/types";

const money = (n: number) => Number((Number(n) || 0).toFixed(2));

// A figure that is genuinely absent, not zero. Excel has no null, and a 0 in a
// money column is a claim — "nothing was agreed" and "£0 was agreed" are
// different statements, and only the first may be left blank (see C2 /
// committedGross in lib/purchases.ts).
const DASH = "—";

/** Everything the workbook needs, all of it already built by a screen's builder. */
export interface WorkbookData {
  project: Project;
  /** Costs tab rows: diary + invoice-derived, ledger excluded. */
  entries: ExpenseEntryComputed[];
  summary: ProjectSummary;
  /** Analysis → By trade. */
  trades: TradeInvoiceRow[];
  /** Analysis → By supplier. */
  suppliers: SupplierInvoiceRow[];
  /** Analysis → Materials: one row per invoice line. */
  materials: InvoiceLineView[];
  /** Analysis → Labour: one row per invoice line. */
  labour: InvoiceLineView[];
  /** Analysis → Price tracker. */
  prices: ItemPriceRow[];
}

// A sheet with no rows gets one placeholder row so the tab still exists and is
// visibly empty, rather than being absent and reading as a missing feature.
const sheet = (
  rows: Record<string, unknown>[],
  placeholder: Record<string, unknown>
) => XLSX.utils.json_to_sheet(rows.length ? rows : [placeholder]);

// One invoice line, for the Materials and Labour sheets. Same columns in the
// same order as the Analysis tab's table, so a reader can put them side by
// side. `Qty` and `Unit price` are the two things only a LINE knows — they are
// the reason these sheets are built from lines and not from documents.
const lineRow = (l: InvoiceLineView) => ({
  Date: l.date ?? "",
  Week: l.week_no ?? "",
  Item: l.description,
  "Filed as": l.item_id && l.item_name !== l.description ? l.item_name : "",
  Supplier: l.supplier,
  Trade: l.trade ?? "",
  Category: l.category ?? "",
  Qty: money(l.qty),
  Unit: l.unit ?? "",
  "Unit price": money(l.unit_price),
  Net: money(l.line_net),
  "VAT %": l.vat_rate,
  VAT: money(l.vat_amount),
  "Cost incl. VAT": money(l.line_gross),
  Invoice: l.invoice_no ?? "",
  "Invoice status": l.purchase_status,
});

export function buildWorkbook(data: WorkbookData): ArrayBuffer {
  const {
    project,
    entries,
    summary,
    trades,
    suppliers,
    materials,
    labour,
    prices,
  } = data;
  const wb = XLSX.utils.book_new();

  // ---- Week-by-Week: the Costs tab, one row per cost row ----
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
      // Blank, not 0, when nothing was agreed in advance — same rule as the
      // Summary sheet below and the Overview's hidden Committed card.
      Committed:
        Number(e.quoted_amount) > 0 ? money(Number(e.quoted_amount)) : DASH,
      Actual: money(Number(e.actual_amount)),
      Paid: money(Number(e.paid_amount)),
      Owed: money(e.remaining),
      Qty: money(e.qty),
      "Unit Cost": money(e.unit_cost),
      "VAT %": e.vat_rate,
      "VAT Amount": money(e.vat_amount),
      "Total incl. VAT": money(e.total_incl_vat),
      Status: e.status,
      "Payment Method": e.payment_method ?? "",
      "Date Paid": e.paid_date ?? "",
      "Invoice Ref": e.invoice_ref ?? "",
      // Where the row came from: a typed Cost row, or an invoice. The two are
      // entered on different screens, and a reader reconciling against paperwork
      // needs to know which rows have a document behind them.
      Source: e.source === "invoice" ? "Invoice" : "Entered by hand",
    }));
  XLSX.utils.book_append_sheet(
    wb,
    sheet(weekRows, { Week: DASH }),
    "Week-by-Week"
  );

  // ---- Summary: the Overview cards, in the same words ----
  const committed = summary.total_quoted > 0.005;
  const fullyCommitted = committed && summary.quoted_coverage >= 0.995;
  const summaryRows = [
    { Metric: "Project", Value: project.name },
    { Metric: "Status", Value: project.status },
    { Metric: "Budget", Value: money(summary.target_budget) },
    // "—" rather than £0.00 when nothing was ever agreed in advance, so the
    // workbook says the same thing the Overview does by hiding the card. And
    // Variance only when the agreed figures cover the whole cost — otherwise it
    // subtracts the quoted jobs from the cost of all of them. See C2 /
    // committedGross in lib/purchases.ts.
    { Metric: "Committed", Value: committed ? money(summary.total_quoted) : DASH },
    {
      Metric: "Committed — % of cost covered",
      Value: committed ? Math.round(summary.quoted_coverage * 100) : DASH,
    },
    { Metric: "Cost", Value: money(summary.forecast_total) },
    {
      Metric: "Variance vs Committed",
      Value: fullyCommitted ? money(summary.variance) : DASH,
    },
    { Metric: "Paid", Value: money(summary.paid_to_date) },
    { Metric: "Owed", Value: money(summary.remaining_to_pay) },
    { Metric: "Weeks tracked", Value: summary.weeks_tracked },
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows),
    "Summary"
  );

  // ---- Trades: Analysis → By trade, invoice by invoice ----
  const tradeRows = trades.map((t) => ({
    Trade: t.trade,
    Suppliers: t.suppliers.join(", "),
    Invoices: t.invoice_count,
    Lines: t.line_count,
    Committed: t.quoted > 0 ? money(t.quoted) : DASH,
    Net: money(t.net),
    VAT: money(t.vat),
    Cost: money(t.gross),
    Paid: money(t.paid),
    Owed: money(t.balance),
    "Last invoice": t.last_date ?? "",
    Status: t.status,
  }));
  XLSX.utils.book_append_sheet(wb, sheet(tradeRows, { Trade: DASH }), "Trades");

  // ---- Suppliers: Analysis → By supplier ----
  // Its own sheet now. It used to be half of a "Materials & Suppliers" sheet
  // that only counted rows categorised as Materials — which on an invoice-fed
  // project meant almost none of them.
  const supplierRows = suppliers.map((s) => ({
    Supplier: s.supplier,
    Categories: s.categories.join(", "),
    Invoices: s.invoice_count,
    Lines: s.line_count,
    Net: money(s.net),
    VAT: money(s.vat),
    Cost: money(s.gross),
    Paid: money(s.paid),
    Owed: money(s.balance),
    "Last invoice": s.last_date ?? "",
    Status: s.status,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    sheet(supplierRows, { Supplier: DASH }),
    "Suppliers"
  );

  // ---- Materials and Labour: Analysis → Materials / Labour, line by line ----
  // Uncategorised lines count as materials, matching materialLines() and the
  // Overview donut — category is optional on an invoice and the extractor does
  // not set it, so "Materials or else labour" would put every uploaded invoice
  // in the wrong half (about.md §6.1).
  XLSX.utils.book_append_sheet(
    wb,
    sheet(materials.map(lineRow), { Item: DASH }),
    "Materials"
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(labour.map(lineRow), { Item: DASH }),
    "Labour"
  );

  // ---- Prices: Analysis → Price tracker, one row per buy ----
  // Flattened to one row per dated purchase rather than one per item, so the
  // trend is sortable and chartable in Excel. The screen shows the same data
  // rolled up to one row per item.
  const priceRows = prices.flatMap((it) =>
    it.points.map((p) => ({
      Item: it.item,
      Date: p.date ?? "",
      Supplier: p.supplier,
      Invoice: p.invoice_no ?? "",
      Qty: money(p.qty),
      Unit: p.unit ?? "",
      "Unit price": money(p.unit_price),
      Net: money(p.line_net),
      // Only when a percentage is honest. A first buy has nothing to compare
      // against, and a pack-size change makes the comparison meaningless — both
      // are said in the Note column instead of being rendered as a number.
      // `delta_pct` is null in exactly those two cases.
      "Change vs prev %": p.delta_pct === null ? "" : money(p.delta_pct),
      Note:
        p.move === "unit_change"
          ? `unit changed, ${p.previous_unit ?? "?"} → ${p.unit ?? "?"}`
          : p.move === "first"
            ? "first buy"
            : "",
    }))
  );
  XLSX.utils.book_append_sheet(wb, sheet(priceRows, { Item: DASH }), "Prices");

  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}
