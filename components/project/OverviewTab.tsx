"use client";

import { formatCurrency } from "@/lib/calculations";
import { StatCard } from "@/components/ui/StatCard";
import { WeeklySpendChart } from "@/components/charts/WeeklySpendChart";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import type {
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  PriceHistoryItem,
} from "@/types";

export default function OverviewTab({
  summary,
  byWeek,
  byCategory,
  priceAlerts,
  onViewPrices,
}: {
  summary: ProjectSummary;
  byWeek: WeekTotal[];
  byCategory: CategoryTotal[];
  // Materials that cost more per unit than the previous purchase.
  priceAlerts: PriceHistoryItem[];
  onViewPrices: () => void;
}) {
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Price rises, surfaced without opening the Price Tracker. */}
      {priceAlerts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-amber-900">
              ⚠ {priceAlerts.length}{" "}
              {priceAlerts.length === 1 ? "item" : "items"} cost more than last
              time
            </h3>
            <button
              type="button"
              onClick={onViewPrices}
              className="text-sm font-medium text-amber-900 underline"
            >
              View Price Tracker
            </button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {priceAlerts.slice(0, 5).map((p) => (
              <li key={p.item} className="flex justify-between gap-3">
                <span className="truncate">{p.item}</span>
                <span className="whitespace-nowrap font-medium">
                  {formatCurrency(p.latest_price)}/unit ▲ +
                  {p.latest_delta_pct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
          {priceAlerts.length > 5 && (
            <p className="mt-1 text-xs text-amber-700">
              +{priceAlerts.length - 5} more
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {summary.target_budget > 0 && (
          <StatCard
            label="Target Budget"
            value={formatCurrency(summary.target_budget)}
          />
        )}
        <StatCard
          label="Total Quoted"
          value={formatCurrency(summary.total_quoted)}
        />
        <StatCard
          label="Actual Total"
          value={formatCurrency(summary.forecast_total)}
        />
        <StatCard
          label="Variance vs Quote"
          value={formatCurrency(summary.variance)}
          tone={summary.variance > 0 ? "bad" : "good"}
          hint={summary.variance > 0 ? "Over quote" : "Within quote"}
        />
        <StatCard
          label="Paid to Date"
          value={formatCurrency(summary.paid_to_date)}
        />
        <StatCard
          label="Remaining to Pay"
          value={formatCurrency(summary.remaining_to_pay)}
        />
        <StatCard label="Weeks Tracked" value={String(summary.weeks_tracked)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Weekly Spend
          </h3>
          <WeeklySpendChart data={byWeek} />
        </div>
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold text-gray-700">
            Labour vs Materials
          </h3>
          <CategoryDonut data={byCategory} />
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-gray-700">
          Week-by-Week
        </h3>
        {byWeek.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">
            No expenses logged yet.
          </p>
        ) : (
          <>
            {/* Mobile: one card per week. */}
            <ul className="space-y-2 sm:hidden">
              {byWeek.map((w) => (
                <li
                  key={w.week_number}
                  className="rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-semibold">Week {w.week_number}</span>
                    <span className="font-semibold">
                      {formatCurrency(w.total)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-gray-500">
                    <div>
                      <dt>Labour</dt>
                      <dd className="text-gray-900">
                        {formatCurrency(w.labour)}
                      </dd>
                    </div>
                    <div>
                      <dt>Materials</dt>
                      <dd className="text-gray-900">
                        {formatCurrency(w.materials)}
                      </dd>
                    </div>
                    <div>
                      <dt>VAT</dt>
                      <dd className="text-gray-900">{formatCurrency(w.vat)}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            {/* Desktop: table. */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gray-500">
                    <th className="py-2">Week</th>
                    <th className="py-2 text-right">Labour</th>
                    <th className="py-2 text-right">Materials</th>
                    <th className="py-2 text-right">VAT</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {byWeek.map((w) => (
                    <tr key={w.week_number}>
                      <td className="py-2 font-medium">W{w.week_number}</td>
                      <td className="py-2 text-right">
                        {formatCurrency(w.labour)}
                      </td>
                      <td className="py-2 text-right">
                        {formatCurrency(w.materials)}
                      </td>
                      <td className="py-2 text-right">
                        {formatCurrency(w.vat)}
                      </td>
                      <td className="py-2 text-right font-medium">
                        {formatCurrency(w.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
