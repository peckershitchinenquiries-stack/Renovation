"use client";

import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import type { TradeSummary } from "@/types";

export default function TradesTab({ trades }: { trades: TradeSummary[] }) {
  if (trades.length === 0)
    return (
      <EmptyState
        title="No trade data"
        description="Trades & labour figures are derived from expense entries."
      />
    );

  const totals = trades.reduce(
    (acc, t) => {
      acc.quoted += t.quoted;
      acc.actual += t.actual;
      acc.paid += t.paid;
      acc.remaining += t.remaining;
      return acc;
    },
    { quoted: 0, actual: 0, paid: 0, remaining: 0 }
  );

  return (
    <>
      {/* Mobile: one card per trade. */}
      <div className="space-y-2 sm:hidden">
        {trades.map((t) => (
          <div key={t.trade} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-medium">{t.trade}</span>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{formatCurrency(t.actual)}</div>
                <Badge label={t.status} />
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <div>
                <dt>Quoted</dt>
                <dd className="text-gray-900">{formatCurrency(t.quoted)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd className="text-gray-900">{formatCurrency(t.paid)}</dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd className="text-gray-900">{formatCurrency(t.remaining)}</dd>
              </div>
            </dl>
          </div>
        ))}
        <div className="card p-3 text-sm font-semibold">
          <div className="flex justify-between">
            <span>Total actual</span>
            <span>{formatCurrency(totals.actual)}</span>
          </div>
          <div className="mt-1 flex justify-between font-normal text-gray-500">
            <span>Paid</span>
            <span>{formatCurrency(totals.paid)}</span>
          </div>
          <div className="mt-1 flex justify-between font-normal text-gray-500">
            <span>Remaining</span>
            <span>{formatCurrency(totals.remaining)}</span>
          </div>
        </div>
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-gray-500">
            <th className="py-2 pr-2">Trade / Person</th>
            <th className="py-2 pr-2 text-right">Quoted</th>
            <th className="py-2 pr-2 text-right">Actual</th>
            <th className="py-2 pr-2 text-right">Paid</th>
            <th className="py-2 pr-2 text-right">Remaining</th>
            <th className="py-2 pr-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {trades.map((t) => (
            <tr key={t.trade}>
              <td className="py-2 pr-2 font-medium">{t.trade}</td>
              <td className="py-2 pr-2 text-right">{formatCurrency(t.quoted)}</td>
              <td className="py-2 pr-2 text-right">{formatCurrency(t.actual)}</td>
              <td className="py-2 pr-2 text-right">{formatCurrency(t.paid)}</td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(t.remaining)}
              </td>
              <td className="py-2 pr-2">
                <Badge label={t.status} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 font-semibold">
            <td className="py-2 pr-2">Total</td>
            <td className="py-2 pr-2 text-right">
              {formatCurrency(totals.quoted)}
            </td>
            <td className="py-2 pr-2 text-right">
              {formatCurrency(totals.actual)}
            </td>
            <td className="py-2 pr-2 text-right">
              {formatCurrency(totals.paid)}
            </td>
            <td className="py-2 pr-2 text-right">
              {formatCurrency(totals.remaining)}
            </td>
            <td />
          </tr>
        </tfoot>
        </table>
      </div>
    </>
  );
}
