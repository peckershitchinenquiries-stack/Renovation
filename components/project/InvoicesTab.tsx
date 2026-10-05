"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { SearchInput } from "@/components/ui/SearchInput";
import { IconTile } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { combineTotals } from "@/components/purchases/totals";
import type { Project, ProjectPurchaseRow, PurchaseTotals } from "@/types";

/**
 * Invoices & purchases — every document filed against one project.
 *
 * This was a route of its own (`/projects/[id]/purchases`) that left the tab
 * strip entirely and needed a `?tab=` link to get back. It is a tab now, and
 * since 2026-10-01 it is ONLY a tab: that route is a `redirect()` to
 * `?tab=invoices` and nothing renders this component any other way.
 *
 * It used to render twice, the route passing `chrome="page"` for its own
 * heading, breadcrumb and a "Log" button. That made one list with two doors —
 * and the invoice form saved you through the wrong one, so filing an invoice
 * dropped you on a bare page instead of back on the job. The prop and its
 * branch are gone with the second door.
 */

// What one row says it is: a hand-typed invoice, or a row copied over from the
// old week-by-week sheet. Only the former is editable through this form; the
// rest show a plain "imported" label instead of an Edit link.
const isManual = (row: ProjectPurchaseRow) => row.origin !== "legacy_import";

/**
 * The link to the original photo or PDF.
 *
 * This is the one place in the app that opens the scanned document, so it gets
 * a real affordance rather than a dotted underline: on a phone, an underlined
 * invoice number inside a line of grey metadata is neither visible as a link
 * nor big enough to hit.
 *
 * The href is the project's document route, never a signed URL. Signing at
 * render time would bake in an expiry the moment the page loaded; the route
 * signs when the link is followed instead.
 *
 * Rows without a document — anything typed in by hand or imported from the old
 * sheet — render nothing. A link that opens nothing reads as a fault when there
 * is none.
 */
function DocumentLink({
  row,
  projectId,
  compact = false,
}: {
  row: ProjectPurchaseRow;
  projectId: string;
  compact?: boolean;
}) {
  if (!row.has_document || !row.invoice_no) {
    return row.invoice_no ? (
      <span className="text-gray-500">{row.invoice_no}</span>
    ) : (
      <span className="text-gray-400">—</span>
    );
  }
  return (
    <a
      href={`/api/projects/${projectId}/purchases/${row.id}/document`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the original invoice"
      className={`inline-flex items-center gap-1.5 font-semibold text-brand-700 ${
        compact ? "" : "underline decoration-brand-300 underline-offset-2"
      }`}
    >
      <Icon name="link" size={13} strokeWidth={2} />
      {row.invoice_no}
    </a>
  );
}

export default function InvoicesTab({
  project,
  rows,
  totals,
}: {
  project: Project;
  rows: ProjectPurchaseRow[];
  totals: PurchaseTotals[];
}) {
  const total = combineTotals(totals);
  const [query, setQuery] = useState("");

  // This is the list that grows without bound: every project ends with more
  // invoices than weeks, and unlike the Costs tab it has no week headings to
  // navigate by. Supplier, invoice number and the first line's description are
  // the three things anyone actually remembers about a document they are
  // hunting for.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      `${row.supplier_name ?? ""} ${row.invoice_no ?? ""} ${
        row.first_description ?? ""
      }`
        .toLowerCase()
        .includes(q)
    );
  }, [rows, query]);

  return (
    <div className="space-y-5">
      {/* One set of totals for the project. Cancelled documents are already
          excluded upstream. */}
      {total ? (
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <StatCard
            icon="chart"
            label={MONEY.cost.label}
            value={formatCurrency(total.gross)}
            hint={MONEY.cost.hint}
            tone="brand"
          />
          <StatCard
            icon="wallet"
            label={MONEY.paid.label}
            value={formatCurrency(total.paid)}
            hint={MONEY.paid.hint}
          />
          <StatCard
            icon="clock"
            label={MONEY.owed.label}
            value={formatCurrency(total.balance)}
            tone={total.balance > 0.001 ? "bad" : "good"}
            hint={MONEY.owed.hint}
          />
          <StatCard
            icon="receipt"
            label="Invoices"
            value={String(total.purchase_count)}
          />
        </div>
      ) : null}

      {/* Hidden until there is a list worth searching — a search box over an
          empty state is furniture. */}
      {rows.length > 0 ? (
        <SearchInput
          id="invoices-search"
          className="sm:max-w-sm"
          value={query}
          onChange={setQuery}
          label="Search invoices"
          placeholder="Supplier, invoice number or description"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="No invoices yet"
          description="Upload a photo or type one in, then choose this project as you save it."
          action={
            <Link href="/invoices" className="btn-primary">
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Log invoice
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        /* A search that matches nothing is not an empty project, and the two
           must not read the same — see the Costs tab for the same distinction. */
        <EmptyState
          icon="search"
          compact
          title="Nothing matches"
          description="No invoice on this project matches that search."
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setQuery("")}
            >
              Clear search
            </button>
          }
        />
      ) : (
        <>
          {/* Mobile: one card per document. The three money figures sit in a
              single row of equal columns rather than a stacked definition list,
              so a column of invoices can be scanned down one number at a time. */}
          <div className="space-y-2.5 sm:hidden">
            {visible.map((row) => (
              <div key={row.id} className="card p-0">
                <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
                  <IconTile
                    name="receipt"
                    tone={row.balance > 0.001 ? "warn" : "good"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                      {row.supplier_name || "No supplier"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {row.purchase_date
                        ? formatDisplayDate(row.purchase_date)
                        : "No date"}
                      {row.week_no ? ` · Week ${row.week_no}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge label={row.status} />
                    {row.entry_status === "Cancelled" ? (
                      <Badge label="Cancelled" />
                    ) : null}
                  </div>
                </div>

                {row.first_description ? (
                  <p className="truncate px-4 pb-3 text-[0.8125rem] text-gray-600">
                    {row.line_count} {row.line_count === 1 ? "line" : "lines"} ·{" "}
                    {row.first_description}
                  </p>
                ) : null}

                <div className="grid grid-cols-3 border-t border-gray-200/70">
                  <MoneyCell label={MONEY.cost.label} value={Number(row.gross_total)} />
                  <MoneyCell label={MONEY.paid.label} value={row.paid} divider />
                  <MoneyCell
                    label={MONEY.owed.label}
                    value={row.balance}
                    divider
                    tone={row.balance > 0.001 ? "bad" : "good"}
                  />
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-gray-200/70 px-4 py-2.5">
                  {/* Same link as the desktop table's Invoice column — a
                      document reachable on one device and not the other is the
                      kind of gap nobody notices until they are on the wrong
                      one. */}
                  <span className="min-w-0 truncate text-[0.8125rem]">
                    <DocumentLink row={row} projectId={project.id} />
                  </span>
                  {isManual(row) ? (
                    <Link
                      href={`/projects/${project.id}/purchases/${row.id}/edit`}
                      className="btn-ghost btn-sm shrink-0 text-brand-700"
                    >
                      <Icon name="edit" size={15} />
                      Edit
                    </Link>
                  ) : (
                    <span className="shrink-0 text-xs text-gray-400">Imported</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                  <th className="pb-2.5 pr-3">Date</th>
                  <th className="pb-2.5 pr-3">Supplier</th>
                  <th className="pb-2.5 pr-3">Invoice</th>
                  <th className="pb-2.5 pr-3 text-right">Lines</th>
                  <th className="pb-2.5 pr-3 text-right" title={MONEY.cost.hint}>
                    {MONEY.cost.label}
                  </th>
                  <th className="pb-2.5 pr-3 text-right" title={MONEY.paid.hint}>
                    {MONEY.paid.label}
                  </th>
                  <th className="pb-2.5 pr-3 text-right" title={MONEY.owed.hint}>
                    {MONEY.owed.label}
                  </th>
                  <th className="pb-2.5 pr-3">Status</th>
                  <th className="pb-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {visible.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="tnum whitespace-nowrap py-2.5 pr-3 text-gray-600">
                      {row.purchase_date || (
                        <span className="text-gray-400">no date</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      {row.supplier_id && row.supplier_name ? (
                        <Link
                          href={`/suppliers/${row.supplier_id}`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          {row.supplier_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      {row.first_description ? (
                        <span className="block max-w-xs truncate text-xs text-gray-500">
                          {row.first_description}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-3">
                      <DocumentLink row={row} projectId={project.id} compact />
                    </td>
                    <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                      {row.line_count}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-right font-semibold text-gray-900">
                      {formatCurrency(Number(row.gross_total))}
                    </td>
                    <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                      {formatCurrency(row.paid)}
                    </td>
                    <td
                      className={`tnum py-2.5 pr-3 text-right font-semibold ${
                        row.balance > 0.001 ? "text-red-600" : "text-gray-400"
                      }`}
                    >
                      {formatCurrency(row.balance)}
                    </td>
                    <td className="space-x-1 py-2.5 pr-3">
                      <Badge label={row.status} />
                      {row.entry_status === "Cancelled" ? (
                        <Badge label="Cancelled" />
                      ) : null}
                    </td>
                    <td className="py-2.5 text-right">
                      {isManual(row) ? (
                        <Link
                          href={`/projects/${project.id}/purchases/${row.id}/edit`}
                          className="font-semibold text-brand-700 hover:underline"
                        >
                          Edit
                        </Link>
                      ) : (
                        <span className="text-xs text-gray-400">imported</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function MoneyCell({
  label,
  value,
  divider = false,
  tone = "neutral",
}: {
  label: string;
  value: number;
  divider?: boolean;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className={`px-3 py-2.5 ${divider ? "border-l border-gray-200/70" : ""}`}>
      <p className="text-2xs font-medium text-gray-400">{label}</p>
      <p
        className={`tnum mt-0.5 truncate text-[0.8125rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-600"
              : "text-gray-900"
        }`}
      >
        {formatCurrency(value)}
      </p>
    </div>
  );
}
