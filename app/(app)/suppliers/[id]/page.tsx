import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplierBundle } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { combineTotals } from "@/components/purchases/totals";
import {
  PaymentSummary,
  PurchaseExpander,
} from "@/components/purchases/PurchaseExpander";
import type { PurchaseDetail } from "@/types";

export const dynamic = "force-dynamic";

// A supplier's statement: every purchase, newest first, with its lines and
// payments underneath.
//
// getSupplierBundle still groups these by entry_source and accumulates the
// running total within each group — that split is what stops a double-count if
// a second dataset is ever imported alongside the invoices. There is only one
// record set today, so the screen shows one statement rather than a labelled
// group with nothing to be distinguished from.
function PurchaseStatement({ purchases }: { purchases: PurchaseDetail[] }) {
  return (
    <section className="space-y-3">
      {/* Mobile: one card per purchase, newest first. */}
      <div className="space-y-2 sm:hidden">
        {purchases.map((p) => (
          <div key={p.id} className="card p-0">
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">
                    {p.purchase_date || "no date"}
                  </p>
                  <p className="text-xs text-gray-500">
                    {p.invoice_no ? `Invoice ${p.invoice_no} · ` : ""}
                    {p.project_name || "—"}
                    {p.week_no ? ` · week ${p.week_no}` : ""}
                  </p>
                </div>
                <Badge label={p.status} />
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
                <dt className="text-gray-500">Gross</dt>
                <dd className="text-right">
                  {formatCurrency(Number(p.gross_total))}
                </dd>
                <dt className="text-gray-500">Paid</dt>
                <dd className="text-right">{formatCurrency(p.paid)}</dd>
                <dt className="text-gray-500">Balance</dt>
                <dd className="text-right">{formatCurrency(p.balance)}</dd>
                <dt className="text-gray-500">Running total</dt>
                <dd className="text-right">
                  {formatCurrency(p.running_total)}
                </dd>
                <dt className="text-gray-500">Payments</dt>
                <dd className="text-right">
                  <PaymentSummary purchase={p} />
                </dd>
              </dl>
            </div>
            <div className="border-t border-gray-100">
              <PurchaseExpander purchase={p} />
            </div>
          </div>
        ))}
      </div>

      <div className="card hidden overflow-x-auto p-0 sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pl-3 pr-2">Date</th>
              <th className="py-2 pr-2">Invoice</th>
              <th className="py-2 pr-2">Project</th>
              <th className="py-2 pr-2 text-right">Gross</th>
              <th className="py-2 pr-2 text-right">Paid</th>
              <th className="py-2 pr-2 text-right">Balance</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">Payments</th>
              <th className="py-2 pr-3 text-right">Running total</th>
            </tr>
          </thead>
          {/* One <tbody> per purchase — a table may repeat tbody, and it keeps
              each summary row glued to its own expandable detail row. */}
          {purchases.map((p) => (
            <tbody key={p.id} className="border-t border-gray-100">
              <tr className="align-top">
                <td className="whitespace-nowrap py-2 pl-3 pr-2">
                  {p.purchase_date || (
                    <span className="text-gray-400">no date</span>
                  )}
                </td>
                <td className="py-2 pr-2">{p.invoice_no || "—"}</td>
                <td className="py-2 pr-2">{p.project_name || "—"}</td>
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(Number(p.gross_total))}
                </td>
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(p.paid)}
                </td>
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(p.balance)}
                </td>
                <td className="py-2 pr-2">
                  <Badge label={p.status} />
                </td>
                <td className="py-2 pr-2">
                  <PaymentSummary purchase={p} />
                </td>
                <td className="py-2 pr-3 text-right font-medium">
                  {formatCurrency(p.running_total)}
                </td>
              </tr>
              <tr>
                <td colSpan={9} className="bg-gray-50 p-0">
                  <PurchaseExpander purchase={p} />
                </td>
              </tr>
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

export default async function SupplierPage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getSupplierBundle(params.id);
  if (!bundle) notFound();
  const { supplier, aliases, groups } = bundle;

  // Aliases the migration seeded are just the supplier's own name back again;
  // only show the ones that add something.
  const otherAliases = aliases.filter((a) => a.alias !== supplier.name);

  const totals = combineTotals(groups.map((g) => g.totals));
  const purchases = groups.flatMap((g) => g.purchases);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/suppliers" className="text-sm text-brand hover:underline">
          ← All suppliers
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
          {supplier.name}
        </h1>
        <p className="text-sm text-gray-500">
          {[supplier.type, supplier.account_ref && `Account ${supplier.account_ref}`]
            .filter(Boolean)
            .join(" · ") || "Across all purchase records, every project."}
        </p>
        {otherAliases.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            Also known as: {otherAliases.map((a) => a.alias).join(", ")}
          </p>
        )}
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Spend (incl VAT)"
            value={formatCurrency(totals.gross)}
          />
          <StatCard label="Paid" value={formatCurrency(totals.paid)} />
          <StatCard
            label="Outstanding"
            value={formatCurrency(totals.balance)}
            tone={totals.balance > 0.001 ? "bad" : "good"}
          />
          <StatCard label="Purchases" value={String(totals.purchase_count)} />
        </div>
      )}

      {purchases.length === 0 ? (
        <EmptyState
          title="No purchases recorded"
          description="This supplier exists but nothing has been bought from it yet — or every record against it is cancelled."
        />
      ) : (
        <PurchaseStatement purchases={purchases} />
      )}
    </div>
  );
}
