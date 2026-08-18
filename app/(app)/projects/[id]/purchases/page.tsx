import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectPurchases } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import {
  InvoiceScopeNote,
  SourceNote,
} from "@/components/purchases/SourceNote";
import type { ProjectPurchaseRow } from "@/types";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = { diary: "Diary", ledger: "Ledger" } as const;

// What one row says it is: a hand-typed invoice, or a row copied over from the
// old week-by-week sheet. Only the former is editable through this form —
// see the note below the table.
const isManual = (row: ProjectPurchaseRow) => row.origin !== "legacy_import";

export default async function ProjectPurchasesPage({
  params,
}: {
  params: { id: string };
}) {
  const list = await getProjectPurchases(params.id);
  if (!list) notFound();
  const { project, rows, totals } = list;

  return (
    <div className="space-y-4">
      <div>
        <nav className="text-xs text-gray-400">
          <Link href={`/projects/${project.id}`} className="hover:underline">
            {project.name}
          </Link>{" "}
          / Invoices
        </nav>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
            Invoices &amp; purchases
          </h1>
          <Link
            href={`/projects/${project.id}/purchases/add`}
            className="btn-primary"
          >
            + Log invoice
          </Link>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          Every document filed against this project — one row per invoice, with
          its own lines and payments underneath.
        </p>
      </div>

      <InvoiceScopeNote />

      {/* One card group per entry_source. They are never added together
          (about.md §5), which is why there is no single "project total" here. */}
      {totals.map((total) => (
        <section key={total.entry_source} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900">
              {SOURCE_LABEL[total.entry_source]}
            </h2>
            <Badge label={total.entry_source} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Invoiced (incl VAT)"
              value={formatCurrency(total.gross)}
            />
            <StatCard label="Paid" value={formatCurrency(total.paid)} />
            <StatCard
              label="Outstanding"
              value={formatCurrency(total.balance)}
              tone={total.balance > 0.001 ? "bad" : "good"}
            />
            <StatCard
              label="Documents"
              value={String(total.purchase_count)}
            />
          </div>
        </section>
      ))}
      {totals.length > 1 && <SourceNote />}

      {rows.length === 0 ? (
        <EmptyState
          title="No purchases yet"
          description="Log the first invoice for this project — pick the supplier, then add a line for each thing on the document."
          action={
            <Link
              href={`/projects/${project.id}/purchases/add`}
              className="btn-primary"
            >
              Log invoice
            </Link>
          }
        />
      ) : (
        <>
          {/* Mobile: one card per document. */}
          <div className="space-y-2 sm:hidden">
            {rows.map((row) => (
              <div key={row.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {row.supplier_name || "No supplier"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {row.purchase_date || "no date"}
                      {row.invoice_no ? ` · ${row.invoice_no}` : ""}
                      {row.week_no ? ` · week ${row.week_no}` : ""}
                    </p>
                  </div>
                  <Badge label={row.status} />
                </div>
                <p className="mt-1 truncate text-xs text-gray-500">
                  {row.line_count}{" "}
                  {row.line_count === 1 ? "line" : "lines"}
                  {row.first_description ? ` · ${row.first_description}` : ""}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
                  <dt className="text-gray-500">Gross</dt>
                  <dd className="text-right">
                    {formatCurrency(Number(row.gross_total))}
                  </dd>
                  <dt className="text-gray-500">Paid</dt>
                  <dd className="text-right">{formatCurrency(row.paid)}</dd>
                  <dt className="text-gray-500">Balance</dt>
                  <dd className="text-right">{formatCurrency(row.balance)}</dd>
                </dl>
                <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
                  <span className="flex gap-1">
                    <Badge label={row.entry_source} />
                    {row.entry_status === "Cancelled" && (
                      <Badge label="Cancelled" />
                    )}
                  </span>
                  {isManual(row) ? (
                    <Link
                      href={`/projects/${project.id}/purchases/${row.id}/edit`}
                      className="text-brand hover:underline"
                    >
                      Edit
                    </Link>
                  ) : (
                    <span className="text-gray-400">imported</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Supplier</th>
                  <th className="py-2 pr-2">Invoice</th>
                  <th className="py-2 pr-2 text-right">Lines</th>
                  <th className="py-2 pr-2 text-right">Gross</th>
                  <th className="py-2 pr-2 text-right">Paid</th>
                  <th className="py-2 pr-2 text-right">Balance</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2 pr-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-2">
                      {row.purchase_date || (
                        <span className="text-gray-400">no date</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {row.supplier_id && row.supplier_name ? (
                        <Link
                          href={`/suppliers/${row.supplier_id}`}
                          className="text-brand hover:underline"
                        >
                          {row.supplier_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                      {row.first_description && (
                        <span className="block max-w-xs truncate text-xs text-gray-500">
                          {row.first_description}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2">{row.invoice_no || "—"}</td>
                    <td className="py-2 pr-2 text-right">{row.line_count}</td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(Number(row.gross_total))}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(row.paid)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(row.balance)}
                    </td>
                    <td className="py-2 pr-2">
                      <Badge label={row.status} />
                      {row.entry_status === "Cancelled" && (
                        <span className="ml-1">
                          <Badge label="Cancelled" />
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <Badge label={row.entry_source} />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {isManual(row) ? (
                        <Link
                          href={`/projects/${project.id}/purchases/${row.id}/edit`}
                          className="text-brand hover:underline"
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

          <p className="text-xs text-gray-500">
            Rows marked <span className="font-medium">imported</span> were
            copied from the week-by-week sheet by migration 0008 and are still
            owned by the older Expenses tab — edit them there, so the two
            records cannot drift apart.
          </p>
        </>
      )}
    </div>
  );
}
