"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Icon } from "@/components/ui/Icon";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import PivotTable, { type PivotColumn } from "./PivotTable";
import { fmtDate, fmtQty, fmtUnitPrice } from "./format";
import type {
  InvoiceLineView,
  ItemPriceRow,
  SupplierInvoiceRow,
  TradeInvoiceRow,
} from "@/types";

/**
 * Analysis — the same invoice data, grouped four ways.
 *
 * Trades, Labour, Materials, Suppliers and Price Tracker were five tabs reading
 * one dataset (`lib/invoiceViews.ts`) grouped by a different column. Five
 * destinations for one question — "where did the money go?" — asked with a
 * different `group by`. That is a pivot, not five screens, so it is one screen
 * with a pivot control now.
 *
 * Labour is deliberately NOT a segment. It is the line view filtered to
 * `category = Labour`; making it a destination of its own implied labour lines
 * came from somewhere other than the invoices, which they do not.
 *
 * Every builder in `lib/invoiceViews.ts` is untouched — this is presentation.
 */

export type AnalysisView = "trade" | "supplier" | "material" | "price";
export type LineCategory = "all" | "materials" | "labour";

const VIEWS: { value: AnalysisView; label: string }[] = [
  { value: "trade", label: "By trade" },
  { value: "supplier", label: "By supplier" },
  { value: "material", label: "By material" },
  { value: "price", label: "Price history" },
];

const CATEGORIES: { value: LineCategory; label: string }[] = [
  { value: "all", label: "All lines" },
  { value: "materials", label: "Materials" },
  { value: "labour", label: "Labour" },
];

export default function AnalysisTab({
  projectId,
  view,
  onViewChange,
  category,
  onCategoryChange,
  tradeRows,
  supplierRows,
  allLines,
  materials,
  labour,
  priceRows,
}: {
  projectId: string;
  view: AnalysisView;
  onViewChange: (view: AnalysisView) => void;
  category: LineCategory;
  onCategoryChange: (category: LineCategory) => void;
  tradeRows: TradeInvoiceRow[];
  supplierRows: SupplierInvoiceRow[];
  allLines: InvoiceLineView[];
  materials: InvoiceLineView[];
  labour: InvoiceLineView[];
  priceRows: ItemPriceRow[];
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const lines =
    category === "labour" ? labour : category === "materials" ? materials : allLines;

  // Sends the labour form back to this pivot rather than to the invoice list,
  // which is where a bare purchase save would otherwise land.
  const logLabourHref = `/projects/${projectId}/labour/new?returnTo=${encodeURIComponent(
    `/projects/${projectId}?tab=analysis&view=labour`
  )}`;

  return (
    <div className="space-y-3">
      {/* The pivot fills the width on a phone: four segments in a strip the
          reader can nudge sideways, rather than a wrapping cluster that
          changes the page height every time the choice changes. */}
      <SegmentedControl
        fill
        label="Group this project's invoices by"
        value={view}
        onChange={onViewChange}
        options={VIEWS}
      />

      {/* The "Log labour" button that used to sit beside this control is gone:
          logging labour is "+ Add → Labour" in the project header now
          (AddMenu.tsx), which is also what fixed the real bug — the only other
          way in was this view's EMPTY STATE, so it vanished the moment the
          project had any labour on it. LineView's empty state keeps its copy,
          for the same reason the Costs tab's does. */}
      {view === "material" && (
        <SegmentedControl
          fill
          label="Which lines"
          value={category}
          onChange={onCategoryChange}
          options={CATEGORIES}
        />
      )}

      <div className="relative">
        <label className="sr-only" htmlFor="analysis-search">
          Search
        </label>
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          id="analysis-search"
          className="input pl-10 pr-10 sm:max-w-sm"
          placeholder={
            view === "trade"
              ? "Trade or supplier"
              : view === "supplier"
                ? "Supplier"
                : view === "price"
                  ? "Item or supplier"
                  : "Item, supplier or invoice number"
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="btn-icon absolute right-1 top-1/2 h-9 min-h-0 w-9 min-w-0 -translate-y-1/2 text-gray-400 sm:left-[19rem] sm:right-auto"
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </div>

      {/* The cross-project half of the same question. Directory answers
          "what have I ever spent with this merchant / on this item"; this
          screen answers it for one job. Neither used to mention the other.
          Below the search rather than beside the pivot: on a phone it was
          wrapping onto its own line anyway, and as a full-width row it is a
          real tap target instead of a 14px link. */}
      {view === "supplier" || view === "material" || view === "price" ? (
        <Link
          href={
            view === "supplier" ? "/directory?view=suppliers" : "/directory?view=items"
          }
          className="flex min-h-touch items-center gap-2 rounded-xl bg-gray-100 px-3.5 text-[0.8125rem] font-semibold text-gray-700 transition active:bg-gray-200"
        >
          <Icon name="store" size={16} className="text-gray-400" />
          {view === "supplier" ? "Suppliers" : "Items"} across all projects
          <Icon name="chevronRight" size={16} className="ml-auto text-gray-400" />
        </Link>
      ) : null}

      {view === "trade" && <TradeView rows={tradeRows} q={q} />}
      {view === "supplier" && (
        <SupplierView
          projectId={projectId}
          rows={supplierRows}
          lines={allLines}
          q={q}
        />
      )}
      {view === "material" && (
        <LineView
          projectId={projectId}
          lines={lines}
          category={category}
          q={q}
          logLabourHref={logLabourHref}
          uncategorised={
            category === "labour"
              ? 0
              : materials.filter((l) => l.category === null).length
          }
        />
      )}
      {view === "price" && (
        <PriceView
          projectId={projectId}
          rows={priceRows}
          q={q}
          hasLines={allLines.length > 0}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- By trade */

// A trade row is a roll-up of whole invoices, not of lines: what was paid is
// recorded against a document, so splitting it across that document's lines
// would invent a figure the payment record never stated.
function TradeView({ rows, q }: { rows: TradeInvoiceRow[]; q: string }) {
  const filtered = useMemo(
    () =>
      q
        ? rows.filter(
            (t) =>
              t.trade.toLowerCase().includes(q) ||
              t.suppliers.some((s) => s.toLowerCase().includes(q))
          )
        : rows,
    [rows, q]
  );

  if (rows.length === 0)
    return (
      <EmptyState
        icon="hammer"
        title="No trades yet"
        description="Trades come from the invoices filed against this project — set the Trade field on an invoice and it will be grouped here."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );
  if (filtered.length === 0) return <NothingMatches />;

  const totals = filtered.reduce(
    (acc, t) => {
      acc.invoices += t.invoice_count;
      acc.quoted += t.quoted;
      acc.net += t.net;
      acc.vat += t.vat;
      acc.gross += t.gross;
      acc.paid += t.paid;
      acc.balance += t.balance;
      return acc;
    },
    { invoices: 0, quoted: 0, net: 0, vat: 0, gross: 0, paid: 0, balance: 0 }
  );

  // Most invoices arrive without a quote first, so the column would otherwise
  // be a wall of "£0.00" that reads like a real zero.
  const showQuoted = totals.quoted > 0;

  const columns: PivotColumn<TradeInvoiceRow>[] = [
    { key: "trade", header: "Trade", cell: (t) => <span className="font-medium">{t.trade}</span> },
    {
      key: "suppliers",
      header: "Suppliers",
      cell: (t) => (
        <span className="block max-w-xs text-xs text-gray-500">
          {t.suppliers.length > 0 ? t.suppliers.join(", ") : "—"}
        </span>
      ),
    },
    {
      key: "invoices",
      header: "Invoices",
      align: "right",
      cell: (t) => t.invoice_count,
      foot: totals.invoices,
    },
    ...(showQuoted
      ? [
          {
            key: "quoted",
            header: MONEY.committed.label,
            title: MONEY.committed.hint,
            align: "right" as const,
            cell: (t: TradeInvoiceRow) =>
              t.quoted > 0 ? formatCurrency(t.quoted) : "—",
            foot: formatCurrency(totals.quoted),
          },
        ]
      : []),
    {
      key: "net",
      header: "Net",
      align: "right",
      cell: (t) => formatCurrency(t.net),
      foot: formatCurrency(totals.net),
    },
    {
      key: "vat",
      header: "VAT",
      align: "right",
      cell: (t) => formatCurrency(t.vat),
      foot: formatCurrency(totals.vat),
    },
    {
      key: "gross",
      header: MONEY.cost.label,
      title: MONEY.cost.hint,
      align: "right",
      cell: (t) => <span className="font-medium">{formatCurrency(t.gross)}</span>,
      foot: formatCurrency(totals.gross),
    },
    {
      key: "paid",
      header: MONEY.paid.label,
      title: MONEY.paid.hint,
      align: "right",
      cell: (t) => formatCurrency(t.paid),
      foot: formatCurrency(totals.paid),
    },
    {
      key: "balance",
      header: MONEY.owed.label,
      title: MONEY.owed.hint,
      align: "right",
      cell: (t) => (
        <span className={t.balance > 0.001 ? "text-red-600" : ""}>
          {formatCurrency(t.balance)}
        </span>
      ),
      foot: formatCurrency(totals.balance),
    },
    {
      key: "last",
      header: "Last invoice",
      cell: (t) => <span className="whitespace-nowrap">{fmtDate(t.last_date)}</span>,
    },
    { key: "status", header: "Status", cell: (t) => <Badge label={t.status} /> },
  ];

  return (
    <PivotTable
      rows={filtered}
      columns={columns}
      rowKey={(t) => t.trade}
      footLabel="Total"
      mobileTotals={
        <MobileTotals gross={totals.gross} paid={totals.paid} balance={totals.balance} />
      }
      card={(t) => (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {t.trade}
              </span>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {t.invoice_count} {t.invoice_count === 1 ? "invoice" : "invoices"} ·{" "}
                {t.line_count} {t.line_count === 1 ? "line" : "lines"}
              </p>
            </div>
            <div className="shrink-0 space-y-1 text-right">
              <div className="tnum text-[0.9375rem] font-bold text-gray-900">
                {formatCurrency(t.gross)}
              </div>
              <Badge label={t.status} />
            </div>
          </div>
          <CardMoney net={t.net} paid={t.paid} balance={t.balance} />
          {t.suppliers.length > 0 && (
            <p className="mt-2 truncate text-xs text-gray-400">
              {t.suppliers.join(", ")}
            </p>
          )}
        </div>
      )}
    />
  );
}

/* ------------------------------------------------------------- By supplier */

// Scoped to this project on purpose. Directory is the cross-project view —
// "what have I ever spent with Lawsons" — and this answers the narrower
// question the project screen is about: what has this job bought from each
// merchant. The link between the two is at the top of this tab.
function SupplierView({
  projectId,
  rows,
  lines,
  q,
}: {
  projectId: string;
  rows: SupplierInvoiceRow[];
  lines: InvoiceLineView[];
  q: string;
}) {
  const filtered = useMemo(
    () => (q ? rows.filter((s) => s.supplier.toLowerCase().includes(q)) : rows),
    [rows, q]
  );

  if (rows.length === 0)
    return (
      <EmptyState
        icon="store"
        title="No suppliers yet"
        description="Suppliers appear here as soon as an invoice is filed against this project."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );
  if (filtered.length === 0) return <NothingMatches />;

  const totals = filtered.reduce(
    (acc, s) => {
      acc.invoices += s.invoice_count;
      acc.net += s.net;
      acc.vat += s.vat;
      acc.gross += s.gross;
      acc.paid += s.paid;
      acc.balance += s.balance;
      return acc;
    },
    { invoices: 0, net: 0, vat: 0, gross: 0, paid: 0, balance: 0 }
  );

  const keyOf = (s: SupplierInvoiceRow) => s.supplier_id ?? s.supplier;
  const linesFor = (s: SupplierInvoiceRow) =>
    lines.filter((l) =>
      s.supplier_id ? l.supplier_id === s.supplier_id : l.supplier_id === null
    );

  const name = (s: SupplierInvoiceRow) =>
    s.supplier_id ? (
      <Link href={`/suppliers/${s.supplier_id}`} className="font-semibold text-brand-700 hover:underline">
        {s.supplier}
      </Link>
    ) : (
      <span className="text-gray-400">{s.supplier}</span>
    );

  const columns: PivotColumn<SupplierInvoiceRow>[] = [
    { key: "supplier", header: "Supplier", cell: (s) => <span className="font-medium">{name(s)}</span> },
    {
      key: "categories",
      header: "Categories",
      cell: (s) => (
        <span className="text-xs text-gray-500">
          {s.categories.length > 0 ? s.categories.join(", ") : "—"}
        </span>
      ),
    },
    {
      key: "invoices",
      header: "Invoices",
      align: "right",
      cell: (s) => s.invoice_count,
      foot: totals.invoices,
    },
    { key: "lines", header: "Lines", align: "right", cell: (s) => s.line_count, foot: null },
    {
      key: "net",
      header: "Net",
      align: "right",
      cell: (s) => formatCurrency(s.net),
      foot: formatCurrency(totals.net),
    },
    {
      key: "vat",
      header: "VAT",
      align: "right",
      cell: (s) => <span className="text-gray-500">{formatCurrency(s.vat)}</span>,
      foot: formatCurrency(totals.vat),
    },
    {
      key: "gross",
      header: MONEY.cost.label,
      title: MONEY.cost.hint,
      align: "right",
      cell: (s) => <span className="font-medium">{formatCurrency(s.gross)}</span>,
      foot: formatCurrency(totals.gross),
    },
    {
      key: "paid",
      header: MONEY.paid.label,
      title: MONEY.paid.hint,
      align: "right",
      cell: (s) => formatCurrency(s.paid),
      foot: formatCurrency(totals.paid),
    },
    {
      key: "balance",
      header: MONEY.owed.label,
      title: MONEY.owed.hint,
      align: "right",
      cell: (s) => (
        <span className={s.balance > 0.001 ? "text-red-600" : ""}>
          {formatCurrency(s.balance)}
        </span>
      ),
      foot: formatCurrency(totals.balance),
    },
    {
      key: "last",
      header: "Last invoice",
      cell: (s) => <span className="whitespace-nowrap">{fmtDate(s.last_date)}</span>,
    },
    { key: "status", header: "Status", cell: (s) => <Badge label={s.status} /> },
  ];

  return (
    <PivotTable
      rows={filtered}
      columns={columns}
      rowKey={keyOf}
      footLabel="Total"
      expandLabel="Lines"
      expandable={(s) => s.line_count > 0}
      expand={(s) => <SupplierLines projectId={projectId} lines={linesFor(s)} />}
      mobileTotals={
        <MobileTotals gross={totals.gross} paid={totals.paid} balance={totals.balance} />
      }
      card={(s) => (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {name(s)}
              </span>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {s.invoice_count} {s.invoice_count === 1 ? "invoice" : "invoices"} ·{" "}
                {s.line_count} {s.line_count === 1 ? "line" : "lines"}
                {s.categories.length > 0 ? ` · ${s.categories.join(", ")}` : ""}
              </p>
            </div>
            <div className="shrink-0 space-y-1 text-right">
              <div className="tnum text-[0.9375rem] font-bold text-gray-900">
                {formatCurrency(s.gross)}
              </div>
              <Badge label={s.status} />
            </div>
          </div>
          <CardMoney net={s.net} paid={s.paid} balance={s.balance} />
          <p className="mt-2 text-xs text-gray-400">
            Last invoice {fmtDate(s.last_date)}
          </p>
        </div>
      )}
    />
  );
}

function SupplierLines({
  projectId,
  lines,
}: {
  projectId: string;
  lines: InvoiceLineView[];
}) {
  if (lines.length === 0)
    return (
      <p className="text-xs text-gray-500">
        This supplier&apos;s invoices have no lines recorded.
      </p>
    );
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-400">
          <th className="py-1.5 pr-3">Date</th>
          <th className="py-1.5 pr-3">Item</th>
          <th className="tnum py-1.5 pr-3 text-right">Qty</th>
          <th className="tnum py-1.5 pr-3 text-right">Unit price</th>
          <th className="tnum py-1.5 pr-3 text-right">Net</th>
          <th className="py-1.5 pr-3">Invoice</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.line_id}>
            <td className="whitespace-nowrap py-1.5 pr-3">{fmtDate(l.date)}</td>
            <td className="py-1.5 pr-3">{l.description}</td>
            <td className="tnum whitespace-nowrap py-1.5 pr-3 text-right">
              {fmtQty(l.qty, l.unit)}
            </td>
            <td className="tnum whitespace-nowrap py-1.5 pr-3 text-right">
              {fmtUnitPrice(l.unit_price, l.unit)}
            </td>
            <td className="tnum py-1.5 pr-3 text-right">{formatCurrency(l.line_net)}</td>
            <td className="py-1.5 pr-3">
              <Link
                href={`/projects/${projectId}/purchases/${l.purchase_id}/edit`}
                className="font-semibold text-brand-700 hover:underline"
              >
                {l.invoice_no || "view"}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --------------------------------------------- By material (and by labour) */

// One row per invoice line, which is the whole point of moving off the
// spreadsheet: a line records what was bought, how many, in what unit and at
// what price each.
//
// Labour arrives here two ways, and the filter cannot tell them apart on
// purpose: off an invoice filed under the Labour category, or typed straight in
// through "Log labour", which writes an ordinary purchase with one Labour line.
// Both are purchases, so both come through labourLines() with no special case.
function LineView({
  projectId,
  lines,
  category,
  q,
  logLabourHref,
  uncategorised,
}: {
  projectId: string;
  lines: InvoiceLineView[];
  category: LineCategory;
  q: string;
  logLabourHref: string;
  uncategorised: number;
}) {
  const isLabour = category === "labour";

  const filtered = useMemo(
    () =>
      q
        ? lines.filter(
            (l) =>
              l.description.toLowerCase().includes(q) ||
              l.item_name.toLowerCase().includes(q) ||
              l.supplier.toLowerCase().includes(q) ||
              (l.invoice_no ?? "").toLowerCase().includes(q)
          )
        : lines,
    [lines, q]
  );

  if (lines.length === 0)
    return isLabour ? (
      <EmptyState
        icon="hammer"
        title="No labour recorded yet"
        description="Log a worker's hours here, or file an invoice with its category set to Labour. Nothing has been recorded against this project yet."
        action={
          <Link href={logLabourHref} className="btn-primary">
            Log labour
          </Link>
        }
      />
    ) : (
      <EmptyState
        icon="list"
        title="No lines yet"
        description="Lines appear here as soon as an invoice is filed against this project — one row per thing bought, with its quantity and price each."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );

  const totals = filtered.reduce(
    (acc, l) => {
      acc.net += l.line_net;
      acc.vat += l.vat_amount;
      acc.gross += l.line_gross;
      return acc;
    },
    { net: 0, vat: 0, gross: 0 }
  );

  const footLabel = `${MONEY.cost.label} (${filtered.length} ${
    filtered.length === 1 ? "line" : "lines"
  })`;

  const columns: PivotColumn<InvoiceLineView>[] = [
    {
      key: "date",
      header: "Date",
      cell: (l) => <span className="whitespace-nowrap">{fmtDate(l.date)}</span>,
    },
    { key: "wk", header: "Wk", cell: (l) => l.week_no ?? "—" },
    {
      key: "item",
      header: isLabour ? "Work" : "Item",
      cell: (l) => (
        <>
          <span className="font-medium">{l.description}</span>
          {/* Only worth showing when the line was filed under a different
              spelling — that is the match the price history is grouped on. */}
          {l.item_id && l.item_name !== l.description && (
            <p className="text-xs text-gray-400">filed as {l.item_name}</p>
          )}
        </>
      ),
    },
    {
      key: "supplier",
      header: isLabour ? "Supplier / Person" : "Supplier",
      cell: (l) =>
        l.supplier_id ? (
          <Link href={`/suppliers/${l.supplier_id}`} className="font-semibold text-brand-700 hover:underline">
            {l.supplier}
          </Link>
        ) : (
          <span className="text-gray-400">{l.supplier}</span>
        ),
    },
    { key: "trade", header: "Trade", cell: (l) => l.trade ?? "—" },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      cell: (l) => <span className="whitespace-nowrap">{fmtQty(l.qty, l.unit)}</span>,
    },
    {
      key: "unit_price",
      header: isLabour ? "Rate" : "Unit price",
      align: "right",
      cell: (l) => (
        <span className="whitespace-nowrap">{fmtUnitPrice(l.unit_price, l.unit)}</span>
      ),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      cell: (l) => formatCurrency(l.line_net),
      foot: formatCurrency(totals.net),
    },
    {
      key: "vat",
      header: "VAT",
      align: "right",
      cell: (l) => <span className="text-gray-500">{formatCurrency(l.vat_amount)}</span>,
      foot: formatCurrency(totals.vat),
    },
    {
      key: "gross",
      header: MONEY.cost.label,
      title: MONEY.cost.hint,
      align: "right",
      cell: (l) => <span className="font-medium">{formatCurrency(l.line_gross)}</span>,
      foot: formatCurrency(totals.gross),
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: (l) => (
        <Link
          href={`/projects/${projectId}/purchases/${l.purchase_id}/edit`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {l.invoice_no || "view"}
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {/* Category is optional on an invoice and the extractor does not set it,
          so lines arrive uncategorised. They are listed rather than hidden —
          but say which ones they are, so the split against Labour can be
          corrected on the invoice. */}
      {uncategorised > 0 && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-[0.8125rem] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-600/15">
          {uncategorised} of these {uncategorised === 1 ? "line has" : "lines have"} no
          category set on {uncategorised === 1 ? "its" : "their"} invoice. They are
          counted as materials here. Set the category on the invoice if any of them is
          really labour.
        </p>
      )}

      {filtered.length === 0 ? (
        <NothingMatches />
      ) : (
        <PivotTable
          rows={filtered}
          columns={columns}
          rowKey={(l) => l.line_id}
          footLabel={footLabel}
          mobileTotals={
            <div className="card">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.9375rem] font-bold text-gray-900">
                  {footLabel}
                </span>
                <span className="tnum text-lg font-bold tracking-[-0.02em] text-gray-900">
                  {formatCurrency(totals.gross)}
                </span>
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[0.8125rem] text-gray-500">
                <span>Net</span>
                <span className="tnum font-semibold">
                  {formatCurrency(totals.net)}
                </span>
              </div>
            </div>
          }
          card={(l) => (
            <div className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                    {l.description}
                  </span>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {l.supplier}
                    {l.trade ? ` · ${l.trade}` : ""}
                    {l.week_no ? ` · week ${l.week_no}` : ""}
                  </p>
                </div>
                <div className="shrink-0 space-y-1 text-right">
                  <div className="tnum text-[0.9375rem] font-bold text-gray-900">
                    {formatCurrency(l.line_gross)}
                  </div>
                  <Badge label={l.purchase_status} />
                </div>
              </div>
              <div className="mt-2.5 flex justify-between gap-3 border-t border-gray-200/70 pt-2.5 text-xs text-gray-500">
                <span className="tnum truncate">
                  {fmtQty(l.qty, l.unit)}
                  {l.unit_price > 0 ? ` @ ${fmtUnitPrice(l.unit_price, l.unit)}` : ""}
                </span>
                <span className="shrink-0 truncate">
                  {fmtDate(l.date)}
                  {l.invoice_no ? ` · ${l.invoice_no}` : ""}
                </span>
              </div>
            </div>
          )}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- Price history */

// One rule the old spreadsheet-backed version did not have: a percentage is
// only shown when both prices are per the SAME unit. "£12 a bag" against "£12 a
// tonne" is not a 0% change, so PriceMoveBadge renders that case as a unit
// change instead of a number.
function PriceView({
  projectId,
  rows,
  q,
  hasLines,
}: {
  projectId: string;
  rows: ItemPriceRow[];
  q: string;
  hasLines: boolean;
}) {
  const filtered = useMemo(
    () =>
      q
        ? rows.filter(
            (r) =>
              r.item.toLowerCase().includes(q) ||
              r.suppliers.some((s) => s.toLowerCase().includes(q))
          )
        : rows,
    [rows, q]
  );

  if (rows.length === 0)
    return (
      <EmptyState
        icon="chart"
        title={hasLines ? "No unit prices recorded yet" : "No price history yet"}
        description={
          hasLines
            ? "This project's invoice lines have a total but no price per unit, so there is nothing to compare. Add the quantity and unit price to a line and it will start a price history."
            : "Log an invoice with its lines — quantity, unit and price each — and the same item bought twice will be compared here."
        }
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );
  if (filtered.length === 0) return <NothingMatches />;

  const totals = filtered.reduce(
    (acc, r) => {
      acc.buys += r.purchase_count;
      acc.net += r.total_net;
      return acc;
    },
    { buys: 0, net: 0 }
  );

  const keyOf = (r: ItemPriceRow) => r.item_id ?? r.item;
  const latestOf = (r: ItemPriceRow) => r.points[r.points.length - 1];

  const columns: PivotColumn<ItemPriceRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (it) => (
        <>
          {it.item_id ? (
            <Link
              href={`/items/${it.item_id}`}
              className="font-semibold text-brand-700 hover:underline"
            >
              {it.item}
            </Link>
          ) : (
            <span className="font-semibold text-gray-900">{it.item}</span>
          )}
          {/* Two different units means the "first → latest" comparison spans a
              pack-size change. Say so. */}
          {it.units.length > 1 && (
            <p className="text-xs text-amber-700">bought in {it.units.join(", ")}</p>
          )}
        </>
      ),
    },
    {
      key: "suppliers",
      header: "Suppliers",
      cell: (it) => (
        <span className="block max-w-xs text-xs text-gray-500">
          {it.suppliers.join(", ")}
        </span>
      ),
    },
    {
      key: "buys",
      header: "Buys",
      align: "right",
      cell: (it) => it.purchase_count,
      foot: totals.buys,
    },
    {
      key: "qty",
      header: "Qty bought",
      align: "right",
      cell: (it) => (
        <span className="whitespace-nowrap">
          {fmtQty(it.total_qty, it.units.length === 1 ? it.units[0] : null)}
        </span>
      ),
    },
    {
      key: "first",
      header: "First price",
      align: "right",
      cell: (it) => (
        <span className="whitespace-nowrap">
          {fmtUnitPrice(it.first_price, it.units[0] ?? null)}
        </span>
      ),
    },
    {
      key: "latest",
      header: "Latest price",
      align: "right",
      cell: (it) => (
        <span className="whitespace-nowrap font-medium">
          {fmtUnitPrice(it.latest_price, latestOf(it)?.unit ?? null)}
        </span>
      ),
    },
    {
      key: "change",
      header: "Latest change",
      align: "right",
      cell: (it) => (
        <PriceMoveBadge
          move={it.trend}
          deltaPct={it.latest_delta_pct}
          unit={latestOf(it)?.unit}
          previousUnit={latestOf(it)?.previous_unit}
        />
      ),
    },
    {
      key: "net",
      header: `${MONEY.cost.label} (net)`,
      align: "right",
      cell: (it) => formatCurrency(it.total_net),
      foot: formatCurrency(totals.net),
    },
  ];

  return (
    <PivotTable
      rows={filtered}
      columns={columns}
      rowKey={keyOf}
      footLabel="Total"
      expandLabel="History"
      expandable={(it) => it.purchase_count > 1}
      expand={(it) => <PriceHistory projectId={projectId} row={it} />}
      mobileTotals={
        <div className="card">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-bold text-gray-900">
              {MONEY.cost.label} (net)
            </span>
            <span className="tnum text-lg font-bold tracking-[-0.02em] text-gray-900">
              {formatCurrency(totals.net)}
            </span>
          </div>
        </div>
      }
      card={(it, { expanded, toggle }) => (
        <div className="card">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {it.item}
              </span>
              <p className="mt-0.5 truncate text-xs text-gray-500">
                {it.suppliers.join(", ")}
              </p>
            </div>
            <span className="shrink-0 text-right">
              <PriceMoveBadge
                move={it.trend}
                deltaPct={it.latest_delta_pct}
                unit={latestOf(it)?.unit}
                previousUnit={latestOf(it)?.previous_unit}
              />
            </span>
          </div>
          <div className="mt-2.5 flex justify-between gap-3 border-t border-gray-200/70 pt-2.5 text-xs text-gray-500">
            <span className="truncate">
              First {fmtUnitPrice(it.first_price, it.units[0] ?? null)} → latest{" "}
              <span className="tnum font-bold text-gray-900">
                {fmtUnitPrice(it.latest_price, latestOf(it)?.unit ?? null)}
              </span>
            </span>
            <span className="shrink-0">
              {it.purchase_count} {it.purchase_count === 1 ? "buy" : "buys"}
            </span>
          </div>
          {it.purchase_count > 1 && (
            <>
              <button
                type="button"
                className="btn-ghost btn-sm mt-2 w-full text-brand-700"
                onClick={toggle}
              >
                {expanded ? "Hide history" : "Show history"}
                <Icon name={expanded ? "chevronUp" : "chevronDown"} size={15} />
              </button>
              {expanded && (
                <ul className="mt-1 space-y-2 border-t border-gray-200/70 pt-2.5 text-xs">
                  {it.points.map((p) => (
                    <li key={p.line_id} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate text-gray-500">
                        {fmtDate(p.date)} · {p.supplier}
                      </span>
                      <span className="tnum shrink-0 whitespace-nowrap font-semibold text-gray-900">
                        {fmtUnitPrice(p.unit_price, p.unit)}{" "}
                        <PriceMoveBadge
                          move={p.move}
                          deltaPct={p.delta_pct}
                          unit={p.unit}
                          previousUnit={p.previous_unit}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    />
  );
}

function PriceHistory({
  projectId,
  row,
}: {
  projectId: string;
  row: ItemPriceRow;
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-400">
          <th className="py-1.5 pr-3">Date</th>
          <th className="py-1.5 pr-3">Supplier</th>
          <th className="py-1.5 pr-3">Invoice</th>
          <th className="tnum py-1.5 pr-3 text-right">Qty</th>
          <th className="tnum py-1.5 pr-3 text-right">Unit price</th>
          <th className="tnum py-1.5 pr-3 text-right">Net</th>
          <th className="tnum py-1.5 pr-3 text-right">vs previous</th>
        </tr>
      </thead>
      <tbody>
        {row.points.map((p) => (
          <tr key={p.line_id}>
            <td className="whitespace-nowrap py-1.5 pr-3">{fmtDate(p.date)}</td>
            <td className="py-1.5 pr-3">{p.supplier}</td>
            <td className="py-1.5 pr-3">
              <Link
                href={`/projects/${projectId}/purchases/${p.purchase_id}/edit`}
                className="font-semibold text-brand-700 hover:underline"
              >
                {p.invoice_no || "view"}
              </Link>
            </td>
            <td className="tnum whitespace-nowrap py-1.5 pr-3 text-right">
              {fmtQty(p.qty, p.unit)}
            </td>
            <td className="tnum whitespace-nowrap py-1.5 pr-3 text-right">
              {fmtUnitPrice(p.unit_price, p.unit)}
            </td>
            <td className="tnum py-1.5 pr-3 text-right">{formatCurrency(p.line_net)}</td>
            <td className="tnum py-1.5 pr-3 text-right">
              <PriceMoveBadge
                move={p.move}
                deltaPct={p.delta_pct}
                unit={p.unit}
                previousUnit={p.previous_unit}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ shared */

// A totals row of £0.00 under an empty table reads as a project that has spent
// nothing, so a search matching nothing replaces the table rather than emptying
// it — the same rule the Costs tab follows.
function NothingMatches() {
  return (
    <EmptyState
      icon="search"
      compact
      title="Nothing matches"
      description="No row on this project matches that search."
    />
  );
}

function CardMoney({
  net,
  paid,
  balance,
}: {
  net: number;
  paid: number;
  balance: number;
}) {
  return (
    <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-gray-200/70 pt-2.5">
      <div>
        <dt className="text-2xs font-medium text-gray-400">Net</dt>
        <dd className="tnum mt-0.5 text-[0.8125rem] font-bold text-gray-900">
          {formatCurrency(net)}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-medium text-gray-400">{MONEY.paid.label}</dt>
        <dd className="tnum mt-0.5 text-[0.8125rem] font-bold text-gray-900">
          {formatCurrency(paid)}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-medium text-gray-400">{MONEY.owed.label}</dt>
        <dd
          className={`tnum mt-0.5 text-[0.8125rem] font-bold ${
            balance > 0.001 ? "text-red-600" : "text-emerald-600"
          }`}
        >
          {formatCurrency(balance)}
        </dd>
      </div>
    </dl>
  );
}

function MobileTotals({
  gross,
  paid,
  balance,
}: {
  gross: number;
  paid: number;
  balance: number;
}) {
  return (
    <div className="card">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[0.9375rem] font-bold text-gray-900">
          {MONEY.cost.label}
        </span>
        <span className="tnum text-lg font-bold tracking-[-0.02em] text-gray-900">
          {formatCurrency(gross)}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-gray-100 px-3 py-2">
          <p className="text-2xs font-medium text-gray-500">{MONEY.paid.label}</p>
          <p className="tnum mt-0.5 text-[0.8125rem] font-bold text-gray-900">
            {formatCurrency(paid)}
          </p>
        </div>
        <div className="rounded-xl bg-gray-100 px-3 py-2">
          <p className="text-2xs font-medium text-gray-500">{MONEY.owed.label}</p>
          <p
            className={`tnum mt-0.5 text-[0.8125rem] font-bold ${
              balance > 0.001 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {formatCurrency(balance)}
          </p>
        </div>
      </div>
    </div>
  );
}
