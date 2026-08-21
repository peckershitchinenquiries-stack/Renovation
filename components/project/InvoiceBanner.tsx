"use client";

import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { combineTotals } from "@/components/purchases/totals";
import type { PurchaseTotals } from "@/types";

/**
 * A compact invoice summary banner shown at the top of each project tab.
 * The "View invoices" link goes to the project's purchases page.
 */
export function InvoiceBanner({
  totals,
  purchasesHref,
}: {
  totals: PurchaseTotals[];
  purchasesHref: string;
}) {
  const total = combineTotals(totals);
  if (!total) return null;

  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-blue-900">
          🧾 Invoice Summary
        </h3>
        <Link
          href={purchasesHref}
          className="text-sm font-medium text-blue-900 underline"
        >
          View all invoices
        </Link>
      </div>
      <div className="mt-3">
        <div className="rounded-lg bg-white/70 px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-blue-600">
            {total.purchase_count} invoice
            {total.purchase_count !== 1 ? "s" : ""}
          </p>
          <dl className="grid grid-cols-3 gap-1 text-xs">
            <div>
              <dt className="text-gray-500">Invoiced</dt>
              <dd className="font-semibold text-gray-900">
                {formatCurrency(total.gross)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Paid</dt>
              <dd className="font-semibold text-gray-900">
                {formatCurrency(total.paid)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Outstanding</dt>
              <dd
                className={`font-semibold ${
                  total.balance > 0.001 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {formatCurrency(total.balance)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
