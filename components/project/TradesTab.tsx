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
    <div className="card overflow-x-auto">
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
  );
}
