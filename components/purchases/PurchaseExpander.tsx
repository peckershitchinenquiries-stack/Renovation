import React from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import type { PurchaseDetail } from "@/types";

// The lines and payments behind one purchase.
//
// A plain <details> element, so these pages stay Server Components — Phase 1 is
// read-only and there is nothing here worth shipping a client bundle for.
export function PurchaseExpander({ purchase }: { purchase: PurchaseDetail }) {
  const lineWord = purchase.lines.length === 1 ? "line" : "lines";
  const payWord = purchase.payments.length === 1 ? "payment" : "payments";

  return (
    <details className="group">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-brand hover:underline">
        <span className="group-open:hidden">▸ </span>
        <span className="hidden group-open:inline">▾ </span>
        {purchase.lines.length} {lineWord} · {purchase.payments.length}{" "}
        {payWord}
      </summary>

      <div className="space-y-3 px-3 pb-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Lines
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left uppercase text-gray-400">
                <th className="py-1 pr-2">Description (as written)</th>
                <th className="py-1 pr-2">Item</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2 text-right">Unit price</th>
                <th className="py-1 pr-2 text-right">Line net</th>
                <th className="py-1 pr-2 text-right">VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {purchase.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 pr-2">{l.description_raw}</td>
                  <td className="py-1 pr-2">
                    {l.item_id && l.item_name ? (
                      <Link
                        href={`/items/${l.item_id}`}
                        className="text-brand hover:underline"
                      >
                        {l.item_name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">unmatched</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {Number(l.qty) > 0 ? Number(l.qty) : "—"}
                  </td>
                  <td className="py-1 pr-2">{l.unit || "—"}</td>
                  <td className="py-1 pr-2 text-right">
                    {Number(l.unit_price) > 0
                      ? formatCurrency(Number(l.unit_price))
                      : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">
                    {formatCurrency(Number(l.line_net))}
                  </td>
                  <td className="py-1 pr-2 text-right">{Number(l.vat_rate)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Payments
          </p>
          {purchase.payments.length === 0 ? (
            <p className="text-xs text-gray-400">
              Nothing paid against this purchase yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left uppercase text-gray-400">
                  <th className="py-1 pr-2">Paid on</th>
                  <th className="py-1 pr-2 text-right">Amount</th>
                  <th className="py-1 pr-2">Method</th>
                  <th className="py-1 pr-2">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {purchase.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-1 pr-2">{p.paid_on || "no date"}</td>
                    <td className="py-1 pr-2 text-right">
                      {formatCurrency(Number(p.amount))}
                    </td>
                    <td className="py-1 pr-2">{p.method || "—"}</td>
                    <td className="py-1 pr-2">{p.reference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {purchase.notes ? (
          <p className="text-xs text-gray-500">
            <span className="font-medium">Notes:</span> {purchase.notes}
          </p>
        ) : null}
      </div>
    </details>
  );
}

// Payment dates and methods, compressed to fit a table cell.
export function PaymentSummary({ purchase }: { purchase: PurchaseDetail }) {
  if (purchase.payments.length === 0)
    return <span className="text-gray-400">—</span>;
  return (
    <span className="text-xs text-gray-600">
      {purchase.payments
        .map((p) => [p.paid_on || "no date", p.method].filter(Boolean).join(" · "))
        .join(", ")}
    </span>
  );
}
