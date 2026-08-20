"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { fmtDate } from "@/components/project/format";
import type { TradeInvoiceRow } from "@/types";

// Trades is now its own screen, split out of the old "Trades & Labour" tab.
//
// A trade row is a roll-up of whole invoices, not of lines: what was paid is
// recorded against a document, so splitting it across that document's lines
// would invent a figure the payment record never stated.

export default function TradesTab({
  projectId,
  rows,
}: {
  projectId: string;
  rows: TradeInvoiceRow[];
}) {
  if (rows.length === 0)
    return (
      <EmptyState
        title="No trades yet"
        description="Trades come from the invoices filed against this project — set the Trade field on an invoice and it will be grouped here."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );

  const totals = rows.reduce(
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

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Every invoice filed against this project, grouped by trade.{" "}
        <Link
          href={`/projects/${projectId}/purchases`}
          className="text-brand hover:underline"
        >
          See the invoices themselves
        </Link>
        .
      </p>

      {/* Mobile: one card per trade. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((t) => (
          <div key={t.trade} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{t.trade}</span>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t.invoice_count}{" "}
                  {t.invoice_count === 1 ? "invoice" : "invoices"} ·{" "}
                  {t.line_count} {t.line_count === 1 ? "line" : "lines"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{formatCurrency(t.gross)}</div>
                <Badge label={t.status} />
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <div>
                <dt>Net</dt>
                <dd className="text-gray-900">{formatCurrency(t.net)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd className="text-gray-900">{formatCurrency(t.paid)}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd
                  className={
                    t.balance > 0.001 ? "text-red-600" : "text-emerald-600"
                  }
                >
                  {formatCurrency(t.balance)}
                </dd>
              </div>
            </dl>
            {t.suppliers.length > 0 && (
              <p className="mt-1 truncate text-xs text-gray-400">
                {t.suppliers.join(", ")}
              </p>
            )}
          </div>
        ))}
        <div className="card p-3 text-sm font-semibold">
          <div className="flex justify-between">
            <span>Total invoiced</span>
            <span>{formatCurrency(totals.gross)}</span>
          </div>
          <div className="mt-1 flex justify-between font-normal text-gray-500">
            <span>Paid</span>
            <span>{formatCurrency(totals.paid)}</span>
          </div>
          <div className="mt-1 flex justify-between font-normal text-gray-500">
            <span>Outstanding</span>
            <span>{formatCurrency(totals.balance)}</span>
          </div>
        </div>
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Trade</th>
              <th className="py-2 pr-2">Suppliers</th>
              <th className="py-2 pr-2 text-right">Invoices</th>
              {showQuoted && <th className="py-2 pr-2 text-right">Quoted</th>}
              <th className="py-2 pr-2 text-right">Net</th>
              <th className="py-2 pr-2 text-right">VAT</th>
              <th className="py-2 pr-2 text-right">Total</th>
              <th className="py-2 pr-2 text-right">Paid</th>
              <th className="py-2 pr-2 text-right">Outstanding</th>
              <th className="py-2 pr-2">Last invoice</th>
              <th className="py-2 pr-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((t) => (
              <tr key={t.trade} className="align-top">
                <td className="py-2 pr-2 font-medium">{t.trade}</td>
                <td className="py-2 pr-2 max-w-xs text-xs text-gray-500">
                  {t.suppliers.length > 0 ? t.suppliers.join(", ") : "—"}
                </td>
                <td className="py-2 pr-2 text-right">{t.invoice_count}</td>
                {showQuoted && (
                  <td className="py-2 pr-2 text-right">
                    {t.quoted > 0 ? formatCurrency(t.quoted) : "—"}
                  </td>
                )}
                <td className="py-2 pr-2 text-right">{formatCurrency(t.net)}</td>
                <td className="py-2 pr-2 text-right">{formatCurrency(t.vat)}</td>
                <td className="py-2 pr-2 text-right font-medium">
                  {formatCurrency(t.gross)}
                </td>
                <td className="py-2 pr-2 text-right">{formatCurrency(t.paid)}</td>
                <td
                  className={`py-2 pr-2 text-right ${
                    t.balance > 0.001 ? "text-red-600" : ""
                  }`}
                >
                  {formatCurrency(t.balance)}
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  {fmtDate(t.last_date)}
                </td>
                <td className="py-2 pr-2">
                  <Badge label={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-2 pr-2" colSpan={2}>
                Total
              </td>
              <td className="py-2 pr-2 text-right">{totals.invoices}</td>
              {showQuoted && (
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(totals.quoted)}
                </td>
              )}
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.net)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.vat)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.gross)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.paid)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.balance)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
