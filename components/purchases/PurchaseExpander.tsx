import React from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { Icon } from "@/components/ui/Icon";
import type { PurchaseDetail } from "@/types";

// The lines and payments behind one purchase.
//
// A plain <details> element, so these pages stay Server Components — Phase 1 is
// read-only and there is nothing here worth shipping a client bundle for.
//
// The lines used to render only as a seven-column table at `text-xs`. On a
// phone that is seven columns in 343px: every cell wrapped to one word per
// line and the numbers stopped lining up at all. There are two renders now —
// a card list up to `sm:` and the table above it — from the same array, the
// rule the rest of the app follows (about.md §8).
export function PurchaseExpander({ purchase }: { purchase: PurchaseDetail }) {
  const lineWord = purchase.lines.length === 1 ? "line" : "lines";
  const payWord = purchase.payments.length === 1 ? "payment" : "payments";

  return (
    <details className="group">
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-1.5 px-4 text-xs font-semibold text-brand-700">
        <Icon
          name="chevronDown"
          size={14}
          strokeWidth={2.5}
          className="transition-transform group-open:rotate-180"
        />
        {purchase.lines.length} {lineWord} · {purchase.payments.length} {payWord}
      </summary>

      <div className="space-y-4 px-4 pb-4">
        <div>
          <p className="eyebrow mb-2">Lines</p>

          {/* Mobile: one block per line. */}
          <ul className="space-y-2 sm:hidden">
            {purchase.lines.map((l) => (
              <li key={l.id} className="rounded-xl bg-white p-3 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold leading-snug text-gray-900">
                    {l.description_raw}
                  </span>
                  <span className="tnum shrink-0 text-[0.8125rem] font-bold text-gray-900">
                    {formatCurrency(Number(l.line_net))}
                  </span>
                </div>
                <p className="tnum mt-1 text-xs text-gray-500">
                  {Number(l.qty) > 0 ? Number(l.qty) : "—"} {l.unit || ""}
                  {Number(l.unit_price) > 0
                    ? ` @ ${formatCurrency(Number(l.unit_price))}`
                    : ""}{" "}
                  · VAT {Number(l.vat_rate)}%
                </p>
                <p className="mt-1 truncate text-xs">
                  {l.item_id && l.item_name ? (
                    <Link
                      href={`/items/${l.item_id}`}
                      className="font-semibold text-brand-700"
                    >
                      {l.item_name}
                    </Link>
                  ) : (
                    <span className="text-gray-400">unmatched item</span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          <table className="hidden w-full text-xs sm:table">
            <thead>
              <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-400">
                <th className="pb-1.5 pr-3">Description (as written)</th>
                <th className="pb-1.5 pr-3">Item</th>
                <th className="pb-1.5 pr-3 text-right">Qty</th>
                <th className="pb-1.5 pr-3">Unit</th>
                <th className="pb-1.5 pr-3 text-right">Unit price</th>
                <th className="pb-1.5 pr-3 text-right">Line net</th>
                <th className="pb-1.5 text-right">VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200/70">
              {purchase.lines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-3 text-gray-700">
                    {l.description_raw}
                  </td>
                  <td className="py-1.5 pr-3">
                    {l.item_id && l.item_name ? (
                      <Link
                        href={`/items/${l.item_id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {l.item_name}
                      </Link>
                    ) : (
                      <span className="text-gray-400">unmatched</span>
                    )}
                  </td>
                  <td className="tnum py-1.5 pr-3 text-right text-gray-600">
                    {Number(l.qty) > 0 ? Number(l.qty) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-600">{l.unit || "—"}</td>
                  <td className="tnum py-1.5 pr-3 text-right text-gray-600">
                    {Number(l.unit_price) > 0
                      ? formatCurrency(Number(l.unit_price))
                      : "—"}
                  </td>
                  <td className="tnum py-1.5 pr-3 text-right font-semibold text-gray-900">
                    {formatCurrency(Number(l.line_net))}
                  </td>
                  <td className="tnum py-1.5 text-right text-gray-600">
                    {Number(l.vat_rate)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="eyebrow mb-2">Payments</p>
          {purchase.payments.length === 0 ? (
            <p className="text-xs text-gray-400">
              Nothing paid against this purchase yet.
            </p>
          ) : (
            <>
              <ul className="space-y-2 sm:hidden">
                {purchase.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 rounded-xl bg-white p-3 shadow-card"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.8125rem] font-semibold text-gray-900">
                        {p.paid_on || "no date"}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-500">
                        {[p.method, p.reference].filter(Boolean).join(" · ") ||
                          "no method recorded"}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-[0.8125rem] font-bold text-gray-900">
                      {formatCurrency(Number(p.amount))}
                    </span>
                  </li>
                ))}
              </ul>

              <table className="hidden w-full text-xs sm:table">
                <thead>
                  <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-400">
                    <th className="pb-1.5 pr-3">Paid on</th>
                    <th className="pb-1.5 pr-3 text-right">Amount</th>
                    <th className="pb-1.5 pr-3">Method</th>
                    <th className="pb-1.5">Reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200/70">
                  {purchase.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="tnum py-1.5 pr-3 text-gray-700">
                        {p.paid_on || "no date"}
                      </td>
                      <td className="tnum py-1.5 pr-3 text-right font-semibold text-gray-900">
                        {formatCurrency(Number(p.amount))}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-600">
                        {p.method || "—"}
                      </td>
                      <td className="py-1.5 text-gray-600">
                        {p.reference || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {purchase.notes ? (
          <p className="rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-gray-600 shadow-card">
            <span className="font-bold text-gray-900">Notes: </span>
            {purchase.notes}
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
