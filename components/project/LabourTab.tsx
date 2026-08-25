"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { fmtDate, fmtQty, fmtUnitPrice } from "@/components/project/format";
import type { InvoiceLineView } from "@/types";

// Labour, split out of the old "Trades & Labour" tab.
//
// Trades answers "how much has each trade cost"; this answers "what work was
// actually charged for" — one row per line of a Labour invoice, with whatever
// the document said about days, hours or rate.
//
// Labour arrives here two ways, and the tab cannot tell them apart on purpose:
// off an invoice filed under the Labour category, or typed straight in through
// "Log labour", which writes an ordinary purchase with one Labour line. Both are
// purchases, so both come through labourLines() with no special case.

export default function LabourTab({
  projectId,
  lines,
}: {
  projectId: string;
  lines: InvoiceLineView[];
}) {
  // Sends the form back to this tab rather than to the invoice list, which is
  // where a bare purchase save would otherwise land.
  const logHref = `/projects/${projectId}/labour/new?returnTo=${encodeURIComponent(
    `/projects/${projectId}?tab=labour`
  )}`;

  if (lines.length === 0)
    return (
      <EmptyState
        title="No labour recorded yet"
        description="Log a worker's hours here, or file an invoice with its category set to Labour. Nothing has been recorded against this project yet."
        action={
          <Link href={logHref} className="btn-primary">
            Log labour
          </Link>
        }
      />
    );

  const totals = lines.reduce(
    (acc, l) => {
      acc.net += l.line_net;
      acc.vat += l.vat_amount;
      acc.gross += l.line_gross;
      return acc;
    },
    { net: 0, vat: 0, gross: 0 }
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-prose text-sm text-gray-500">
          Every labour line charged to this project.{" "}
          <span className="text-gray-400">
            Paid and outstanding are recorded per invoice, not per line — see{" "}
          </span>
          <Link
            href={`/projects/${projectId}/purchases`}
            className="text-brand hover:underline"
          >
            Invoices
          </Link>
          <span className="text-gray-400"> for what has been settled.</span>
        </p>
        <Link href={logHref} className="btn-primary shrink-0">
          Log labour
        </Link>
      </div>

      {/* Mobile: one card per line. */}
      <div className="space-y-2 sm:hidden">
        {lines.map((l) => (
          <div key={l.line_id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{l.description}</span>
                <p className="mt-0.5 text-xs text-gray-500">
                  {l.supplier}
                  {l.trade ? ` · ${l.trade}` : ""}
                  {l.week_no ? ` · week ${l.week_no}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">
                  {formatCurrency(l.line_gross)}
                </div>
                <Badge label={l.purchase_status} />
              </div>
            </div>
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
              <span>
                {fmtQty(l.qty, l.unit)}
                {l.unit_price > 0
                  ? ` @ ${fmtUnitPrice(l.unit_price, l.unit)}`
                  : ""}
              </span>
              <span>{fmtDate(l.date)}</span>
            </div>
          </div>
        ))}
        <div className="card p-3 text-sm">
          <div className="flex justify-between font-semibold">
            <span>
              Total ({lines.length} {lines.length === 1 ? "line" : "lines"})
            </span>
            <span>{formatCurrency(totals.gross)}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-500">
            <span>Net</span>
            <span>{formatCurrency(totals.net)}</span>
          </div>
        </div>
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Date</th>
              <th className="py-2 pr-2">Wk</th>
              <th className="py-2 pr-2">Work</th>
              <th className="py-2 pr-2">Supplier / Person</th>
              <th className="py-2 pr-2">Trade</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Rate</th>
              <th className="py-2 pr-2 text-right">Net</th>
              <th className="py-2 pr-2 text-right">VAT</th>
              <th className="py-2 pr-2 text-right">Total</th>
              <th className="py-2 pr-2">Invoice</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {lines.map((l) => (
              <tr key={l.line_id} className="align-top">
                <td className="py-2 pr-2 whitespace-nowrap">{fmtDate(l.date)}</td>
                <td className="py-2 pr-2">{l.week_no ?? "—"}</td>
                <td className="py-2 pr-2 font-medium">{l.description}</td>
                <td className="py-2 pr-2">
                  {l.supplier_id ? (
                    <Link
                      href={`/suppliers/${l.supplier_id}`}
                      className="text-brand hover:underline"
                    >
                      {l.supplier}
                    </Link>
                  ) : (
                    l.supplier
                  )}
                </td>
                <td className="py-2 pr-2">{l.trade ?? "—"}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">
                  {fmtQty(l.qty, l.unit)}
                </td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">
                  {fmtUnitPrice(l.unit_price, l.unit)}
                </td>
                <td className="py-2 pr-2 text-right">
                  {formatCurrency(l.line_net)}
                </td>
                <td className="py-2 pr-2 text-right text-gray-500">
                  {formatCurrency(l.vat_amount)}
                </td>
                <td className="py-2 pr-2 text-right font-medium">
                  {formatCurrency(l.line_gross)}
                </td>
                <td className="py-2 pr-2">
                  <Link
                    href={`/projects/${projectId}/purchases/${l.purchase_id}/edit`}
                    className="text-brand hover:underline"
                  >
                    {l.invoice_no || "view"}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-2 pr-2" colSpan={7}>
                Total ({lines.length} {lines.length === 1 ? "line" : "lines"})
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.net)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.vat)}
              </td>
              <td className="py-2 pr-2 text-right">
                {formatCurrency(totals.gross)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
