"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { combineTotals } from "@/components/purchases/totals";
import type { Project, ProjectPurchaseRow, PurchaseTotals } from "@/types";

/**
 * Invoices & purchases — every document filed against one project.
 *
 * This was a route of its own (`/projects/[id]/purchases`) that left the tab
 * strip entirely and needed a `?tab=` link to get back. It is a tab now. The
 * route still exists and still works — plenty of screens link to it — and
 * renders this same component, so there is one list rather than two.
 *
 * `chrome` is the only difference between the two renders: the route needs its
 * own heading and breadcrumb, and inside the tab strip the project name is
 * already two inches above in the project header.
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
  chrome = "tab",
}: {
  project: Project;
  rows: ProjectPurchaseRow[];
  totals: PurchaseTotals[];
  chrome?: "page" | "tab";
}) {
  const total = combineTotals(totals);

  return (
    <div className="space-y-5">
      {/* Only the standalone route carries an add button of its own. Inside the
          tab strip the project header's "+ Add → Invoice" is two inches above
          it and goes to the same place (AddMenu.tsx); on `/projects/[id]/
          purchases` there is no project header, so without this button the page
          would have no way to log an invoice at all. */}
      {chrome === "page" ? (
        <PageHeader
          title="Invoices"
          subtitle={project.name}
          backHref={`/projects/${project.id}`}
          backLabel="Back to project"
          action={
            // Adding happens from the nav bar's Invoices menu, not here: an
            // invoice is filed against a project on the form itself now, so
            // there is one add flow rather than one per project.
            <Link href="/invoices" className="btn-primary btn-sm">
              <Icon name="plus" size={16} strokeWidth={2.25} />
              Log
            </Link>
          }
        />
      ) : null}

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
      ) : (
        <>
          {/* Mobile: one card per document. The three money figures sit in a
              single row of equal columns rather than a stacked definition list,
              so a column of invoices can be scanned down one number at a time. */}
          <div className="space-y-2.5 sm:hidden">
            {rows.map((row) => (
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
                {rows.map((row) => (
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
