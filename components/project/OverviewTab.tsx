"use client";

import { formatCurrency } from "@/lib/calculations";
import { MONEY, BUDGET } from "@/lib/vocabulary";
import { StatCard } from "@/components/ui/StatCard";
import { SectionHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { WeeklySpendChart } from "@/components/charts/WeeklySpendChart";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { combineTotals } from "@/components/purchases/totals";
import type {
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  ItemPriceRow,
  PurchaseTotals,
} from "@/types";

export default function OverviewTab({
  summary,
  byWeek,
  byCategory,
  priceAlerts,
  onViewPrices,
  invoiceTotals,
  onViewInvoices,
}: {
  summary: ProjectSummary;
  byWeek: WeekTotal[];
  byCategory: CategoryTotal[];
  // Items whose latest invoice priced them higher per unit than the buy before,
  // comparing like with like — an item bought in a different unit this time is
  // not in here, because no honest percentage exists for it.
  priceAlerts: ItemPriceRow[];
  onViewPrices: () => void;
  // What part of the Cost card came in on invoices. This is a SUBSET of the
  // cards below, not a separate pot — see the note rendered under the cards.
  invoiceTotals: PurchaseTotals[];
  // The invoice list is a tab now, not a route, so this switches tab rather
  // than navigating away from the project screen.
  onViewInvoices: () => void;
}) {
  const invoiced = combineTotals(invoiceTotals);

  return (
    <div className="space-y-6">
      {/* Price rises, surfaced without opening Analysis. First on the tab
          because it is the only thing here that asks the reader to do
          something; everything below it is reference. */}
      {priceAlerts.length > 0 ? (
        <section className="overflow-hidden rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-600/15">
          <div className="flex items-start gap-3 px-4 pt-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Icon name="arrowUp" size={17} strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[0.9375rem] font-bold text-amber-900">
                {priceAlerts.length} {priceAlerts.length === 1 ? "item" : "items"}{" "}
                cost more than last time
              </h3>
              <p className="mt-0.5 text-xs text-amber-800/80">
                Compared with the previous invoice, like for like.
              </p>
            </div>
          </div>

          <ul className="mt-3 divide-y divide-amber-600/10 border-t border-amber-600/10">
            {priceAlerts.slice(0, 5).map((p) => {
              const unit = p.units[p.units.length - 1];
              return (
                <li
                  key={p.item_id ?? p.item}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-amber-900">
                    {p.item}
                  </span>
                  <span className="tnum shrink-0 text-sm font-semibold text-amber-900">
                    {formatCurrency(p.latest_price)}
                    {unit ? `/${unit}` : ""}
                  </span>
                  <span className="tnum shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 text-2xs font-bold text-amber-900">
                    +{(p.latest_delta_pct ?? 0).toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={onViewPrices}
            className="flex min-h-touch w-full items-center justify-center gap-1.5 border-t border-amber-600/10 px-4 text-sm font-semibold text-amber-900 transition active:bg-amber-100"
          >
            {priceAlerts.length > 5
              ? `See all ${priceAlerts.length} in price history`
              : "See price history"}
            <Icon name="chevronRight" size={16} strokeWidth={2.25} />
          </button>
        </section>
      ) : null}

      {/* The project's money, in the four words used on every other screen —
          see lib/vocabulary.ts. Each card carries the one-line definition, so
          nobody has to guess whether "Cost" includes VAT or whether it counts
          invoices. */}
      <section>
        <SectionHeader title="The money" hint="All figures include VAT" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {summary.target_budget > 0 ? (
            <StatCard
              icon="wallet"
              label={BUDGET.label}
              value={formatCurrency(summary.target_budget)}
              hint={BUDGET.hint}
            />
          ) : null}
          <StatCard
            icon="check"
            label={MONEY.committed.label}
            value={formatCurrency(summary.total_quoted)}
            hint={MONEY.committed.hint}
          />
          <StatCard
            icon="chart"
            label={MONEY.cost.label}
            value={formatCurrency(summary.forecast_total)}
            hint={MONEY.cost.hint}
            tone="brand"
          />
          <StatCard
            icon={summary.variance > 0 ? "arrowUp" : "arrowDown"}
            label="Variance"
            value={formatCurrency(summary.variance)}
            tone={summary.variance > 0 ? "bad" : "good"}
            hint={
              summary.variance > 0
                ? `Over ${MONEY.committed.label.toLowerCase()}`
                : `Within ${MONEY.committed.label.toLowerCase()}`
            }
          />
          <StatCard
            icon="wallet"
            label={MONEY.paid.label}
            value={formatCurrency(summary.paid_to_date)}
            hint={MONEY.paid.hint}
          />
          <StatCard
            icon="clock"
            label={MONEY.owed.label}
            value={formatCurrency(summary.remaining_to_pay)}
            tone={summary.remaining_to_pay > 0.001 ? "bad" : "good"}
            hint={MONEY.owed.hint}
          />
          <StatCard
            icon="calendar"
            label="Weeks tracked"
            value={String(summary.weeks_tracked)}
          />
        </div>

        {/* Where the Cost figure came from.
            This replaces the "Invoice Summary" banner that used to sit above all
            seven tabs. That banner repeated Invoiced / Paid / Outstanding in its
            own words directly above these cards, and because invoice rows are
            already counted in Cost above (they arrive with source: "invoice", so
            the diary filter keeps them), it was showing a SUBSET of the number
            beside it as though it were a separate total. Anyone comparing the two
            concluded the app disagreed with itself.
            One sentence, on the one tab that is about totals, saying plainly that
            it is a part of the figure above. */}
        {invoiced && invoiced.purchase_count > 0 ? (
          <button
            type="button"
            onClick={onViewInvoices}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 text-left transition active:bg-gray-200"
          >
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-gray-600">
              <span className="tnum font-bold text-gray-900">
                {formatCurrency(invoiced.gross)}
              </span>{" "}
              of that {MONEY.cost.label.toLowerCase()} came in on{" "}
              {invoiced.purchase_count}{" "}
              {invoiced.purchase_count === 1 ? "invoice" : "invoices"}
              {invoiced.balance > 0.001 ? (
                <>
                  , of which{" "}
                  <span className="tnum font-bold text-red-600">
                    {formatCurrency(invoiced.balance)}
                  </span>{" "}
                  is still {MONEY.owed.label.toLowerCase()}.
                </>
              ) : (
                ", all paid."
              )}
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-gray-400" />
          </button>
        ) : null}
      </section>

      <section>
        <SectionHeader title="Where the money went" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-[0.8125rem] font-semibold text-gray-600">
              Weekly spend
            </h3>
            <WeeklySpendChart data={byWeek} />
          </div>
          <div className="card">
            <h3 className="mb-3 text-[0.8125rem] font-semibold text-gray-600">
              Labour vs materials
            </h3>
            <CategoryDonut data={byCategory} />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Week by week"
          hint={byWeek.length ? `${byWeek.length} weeks logged` : undefined}
        />
        {byWeek.length === 0 ? (
          <div className="card py-10 text-center">
            <p className="text-sm text-gray-500">No costs logged yet.</p>
          </div>
        ) : (
          <>
            {/* Mobile: one row per week, with the split underneath. A five
                column table on a 375px screen is unreadable at any font size. */}
            <ul className="card-flush row-divide sm:hidden">
              {byWeek.map((w) => (
                <li key={w.week_number} className="px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.9375rem] font-bold text-gray-900">
                      Week {w.week_number}
                    </span>
                    <span className="tnum text-[0.9375rem] font-bold text-gray-900">
                      {formatCurrency(w.total)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2">
                    <WeekSplit label="Labour" value={w.labour} />
                    <WeekSplit label="Materials" value={w.materials} />
                    <WeekSplit label="VAT" value={w.vat} />
                  </dl>
                </li>
              ))}
            </ul>

            {/* Desktop: table. */}
            <div className="card hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                    <th className="pb-2.5">Week</th>
                    <th className="pb-2.5 text-right">Labour</th>
                    <th className="pb-2.5 text-right">Materials</th>
                    <th className="pb-2.5 text-right">VAT</th>
                    <th className="pb-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="tnum divide-y divide-gray-200/70">
                  {byWeek.map((w) => (
                    <tr key={w.week_number}>
                      <td className="py-2.5 font-semibold text-gray-900">
                        W{w.week_number}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.labour)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.materials)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.vat)}
                      </td>
                      <td className="py-2.5 text-right font-bold text-gray-900">
                        {formatCurrency(w.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function WeekSplit({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-100 px-2.5 py-2">
      <dt className="text-2xs font-medium text-gray-500">{label}</dt>
      <dd className="tnum mt-0.5 text-[0.8125rem] font-semibold text-gray-900">
        {formatCurrency(value)}
      </dd>
    </div>
  );
}
