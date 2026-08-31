import { notFound } from "next/navigation";
import { getSupplierBundle } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { IconTile } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { combineTotals } from "@/components/purchases/totals";
import {
  PaymentSummary,
  PurchaseExpander,
} from "@/components/purchases/PurchaseExpander";
import type { PurchaseDetail } from "@/types";

export const dynamic = "force-dynamic";

/** One of the three money figures on a mobile statement card. */
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
    <section>
      {/* Mobile: one card per purchase, newest first. The three money figures
          sit in a row of equal columns rather than a five-row definition list —
          a statement is read by scanning one column downwards, not by reading
          five label/value pairs per entry. */}
      <div className="space-y-2.5 sm:hidden">
        {purchases.map((p) => (
          <div key={p.id} className="card p-0">
            <div className="flex items-start gap-3 px-4 pb-3 pt-3.5">
              <IconTile
                name="receipt"
                tone={p.balance > 0.001 ? "warn" : "good"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                  {p.purchase_date
                    ? formatDisplayDate(p.purchase_date)
                    : "No date"}
                </p>
                <p className="mt-0.5 truncate text-xs text-gray-500">
                  {p.invoice_no ? `Invoice ${p.invoice_no} · ` : ""}
                  {p.project_name || "—"}
                  {p.week_no ? ` · week ${p.week_no}` : ""}
                </p>
              </div>
              <Badge label={p.status} />
            </div>

            <div className="grid grid-cols-3 border-t border-gray-200/70">
              <MoneyCell label={MONEY.cost.label} value={Number(p.gross_total)} />
              <MoneyCell label={MONEY.paid.label} value={p.paid} divider />
              <MoneyCell
                label={MONEY.owed.label}
                value={p.balance}
                divider
                tone={p.balance > 0.001 ? "bad" : "good"}
              />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-gray-200/70 px-4 py-2.5 text-xs">
              <span className="min-w-0 truncate text-gray-500">
                <PaymentSummary purchase={p} />
              </span>
              <span className="tnum shrink-0 text-gray-500">
                Running{" "}
                <span className="font-bold text-gray-900">
                  {formatCurrency(p.running_total)}
                </span>
              </span>
            </div>

            <div className="border-t border-gray-200/70">
              <PurchaseExpander purchase={p} />
            </div>
          </div>
        ))}
      </div>

      <div className="card hidden overflow-x-auto p-0 sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
              <th className="pb-2.5 pl-4 pr-3 pt-4">Date</th>
              <th className="pb-2.5 pr-3 pt-4">Invoice</th>
              <th className="pb-2.5 pr-3 pt-4">Project</th>
              <th className="pb-2.5 pr-3 pt-4 text-right" title={MONEY.cost.hint}>
                {MONEY.cost.label}
              </th>
              <th className="pb-2.5 pr-3 pt-4 text-right" title={MONEY.paid.hint}>
                {MONEY.paid.label}
              </th>
              <th className="pb-2.5 pr-3 pt-4 text-right" title={MONEY.owed.hint}>
                {MONEY.owed.label}
              </th>
              <th className="pb-2.5 pr-3 pt-4">Status</th>
              <th className="pb-2.5 pr-3 pt-4">Payments</th>
              <th className="pb-2.5 pr-4 pt-4 text-right">Running total</th>
            </tr>
          </thead>
          {/* One <tbody> per purchase — a table may repeat tbody, and it keeps
              each summary row glued to its own expandable detail row. */}
          {purchases.map((p) => (
            <tbody key={p.id} className="border-t border-gray-200/70">
              <tr className="align-top">
                <td className="tnum whitespace-nowrap py-2.5 pl-4 pr-3 text-gray-600">
                  {p.purchase_date || (
                    <span className="text-gray-400">no date</span>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-gray-600">
                  {p.invoice_no || "—"}
                </td>
                <td className="py-2.5 pr-3 text-gray-600">
                  {p.project_name || "—"}
                </td>
                <td className="tnum py-2.5 pr-3 text-right font-semibold text-gray-900">
                  {formatCurrency(Number(p.gross_total))}
                </td>
                <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                  {formatCurrency(p.paid)}
                </td>
                <td
                  className={`tnum py-2.5 pr-3 text-right font-semibold ${
                    p.balance > 0.001 ? "text-red-600" : "text-gray-400"
                  }`}
                >
                  {formatCurrency(p.balance)}
                </td>
                <td className="py-2.5 pr-3">
                  <Badge label={p.status} />
                </td>
                <td className="py-2.5 pr-3 text-xs text-gray-500">
                  <PaymentSummary purchase={p} />
                </td>
                <td className="tnum py-2.5 pr-4 text-right font-bold text-gray-900">
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
    <div>
      {/* Back goes to the Directory rather than the old /suppliers route: they
          render the same list, and the Directory is the one the bottom tab bar
          lights up, so the arrow now lands where the nav says you are. */}
      <PageHeader
        title={supplier.name}
        subtitle={
          [
            supplier.type,
            supplier.account_ref && `Account ${supplier.account_ref}`,
          ]
            .filter(Boolean)
            .join(" · ") || "Across every project"
        }
        backHref="/directory?view=suppliers"
        backLabel="All suppliers"
      />

      <div className="space-y-4">
        {otherAliases.length > 0 ? (
          <p className="text-xs text-gray-500">
            Also known as: {otherAliases.map((a) => a.alias).join(", ")}
          </p>
        ) : null}

        {totals ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard
              icon="chart"
              tone="brand"
              label={MONEY.cost.label}
              value={formatCurrency(totals.gross)}
              hint={MONEY.cost.hint}
            />
            <StatCard
              icon="wallet"
              label={MONEY.paid.label}
              value={formatCurrency(totals.paid)}
              hint={MONEY.paid.hint}
            />
            <StatCard
              icon="clock"
              label={MONEY.owed.label}
              value={formatCurrency(totals.balance)}
              tone={totals.balance > 0.001 ? "bad" : "good"}
              hint={MONEY.owed.hint}
            />
            <StatCard
              icon="receipt"
              label="Purchases"
              value={String(totals.purchase_count)}
            />
          </div>
        ) : null}

        {purchases.length === 0 ? (
          <EmptyState
            icon="receipt"
            title="No purchases recorded"
            description="This supplier exists but nothing has been bought from it yet — or every record against it is cancelled."
          />
        ) : (
          <PurchaseStatement purchases={purchases} />
        )}
      </div>
    </div>
  );
}
