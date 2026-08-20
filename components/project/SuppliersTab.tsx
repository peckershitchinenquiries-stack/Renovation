"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { fmtDate, fmtQty, fmtUnitPrice } from "@/components/project/format";
import type { InvoiceLineView, SupplierInvoiceRow } from "@/types";

// Suppliers, split out of the old "Materials & Suppliers" tab.
//
// Scoped to this project on purpose. /suppliers in the nav bar is the
// cross-project view — "what have I ever spent with Lawsons" — and this
// answers the narrower question the project screen is actually about: what has
// this job bought from each merchant.

export default function SuppliersTab({
  projectId,
  rows,
  lines,
}: {
  projectId: string;
  rows: SupplierInvoiceRow[];
  // Every line on the project, so a supplier can be expanded to show what was
  // actually bought from it without another round trip.
  lines: InvoiceLineView[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0)
    return (
      <EmptyState
        title="No suppliers yet"
        description="Suppliers appear here as soon as an invoice is filed against this project."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );

  const totals = rows.reduce(
    (acc, s) => {
      acc.invoices += s.invoice_count;
      acc.net += s.net;
      acc.vat += s.vat;
      acc.gross += s.gross;
      acc.paid += s.paid;
      acc.balance += s.balance;
      return acc;
    },
    { invoices: 0, net: 0, vat: 0, gross: 0, paid: 0, balance: 0 }
  );

  const keyOf = (s: SupplierInvoiceRow) => s.supplier_id ?? s.supplier;
  const linesFor = (s: SupplierInvoiceRow) =>
    lines.filter((l) =>
      s.supplier_id ? l.supplier_id === s.supplier_id : l.supplier_id === null
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        What this project has bought from each merchant.{" "}
        <Link href="/suppliers" className="text-brand hover:underline">
          Suppliers across every project
        </Link>{" "}
        lives in the menu above.
      </p>

      {/* Mobile: one card per supplier. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((s) => (
          <div key={keyOf(s)} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {s.supplier_id ? (
                  <Link
                    href={`/suppliers/${s.supplier_id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {s.supplier}
                  </Link>
                ) : (
                  <span className="font-medium text-gray-500">{s.supplier}</span>
                )}
                <p className="mt-0.5 text-xs text-gray-500">
                  {s.invoice_count}{" "}
                  {s.invoice_count === 1 ? "invoice" : "invoices"} ·{" "}
                  {s.line_count} {s.line_count === 1 ? "line" : "lines"}
                  {s.categories.length > 0 ? ` · ${s.categories.join(", ")}` : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{formatCurrency(s.gross)}</div>
                <Badge label={s.status} />
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
              <div>
                <dt>Net</dt>
                <dd className="text-gray-900">{formatCurrency(s.net)}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd className="text-gray-900">{formatCurrency(s.paid)}</dd>
              </div>
              <div>
                <dt>Outstanding</dt>
                <dd
                  className={
                    s.balance > 0.001 ? "text-red-600" : "text-emerald-600"
                  }
                >
                  {formatCurrency(s.balance)}
                </dd>
              </div>
            </dl>
            <p className="mt-1 text-xs text-gray-400">
              Last invoice {fmtDate(s.last_date)}
            </p>
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

      {/* Desktop: table, expandable to the lines bought from each supplier. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Supplier</th>
              <th className="py-2 pr-2">Categories</th>
              <th className="py-2 pr-2 text-right">Invoices</th>
              <th className="py-2 pr-2 text-right">Lines</th>
              <th className="py-2 pr-2 text-right">Net</th>
              <th className="py-2 pr-2 text-right">VAT</th>
              <th className="py-2 pr-2 text-right">Total</th>
              <th className="py-2 pr-2 text-right">Paid</th>
              <th className="py-2 pr-2 text-right">Outstanding</th>
              <th className="py-2 pr-2">Last invoice</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((s) => {
              const key = keyOf(s);
              const isOpen = open === key;
              const own = isOpen ? linesFor(s) : [];
              return (
                <Fragment key={key}>
                  <tr className="align-top">
                    <td className="py-2 pr-2 font-medium">
                      {s.supplier_id ? (
                        <Link
                          href={`/suppliers/${s.supplier_id}`}
                          className="text-brand hover:underline"
                        >
                          {s.supplier}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{s.supplier}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-xs text-gray-500">
                      {s.categories.length > 0 ? s.categories.join(", ") : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right">{s.invoice_count}</td>
                    <td className="py-2 pr-2 text-right">{s.line_count}</td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(s.net)}
                    </td>
                    <td className="py-2 pr-2 text-right text-gray-500">
                      {formatCurrency(s.vat)}
                    </td>
                    <td className="py-2 pr-2 text-right font-medium">
                      {formatCurrency(s.gross)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(s.paid)}
                    </td>
                    <td
                      className={`py-2 pr-2 text-right ${
                        s.balance > 0.001 ? "text-red-600" : ""
                      }`}
                    >
                      {formatCurrency(s.balance)}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {fmtDate(s.last_date)}
                    </td>
                    <td className="py-2 pr-2">
                      <Badge label={s.status} />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <button
                        type="button"
                        className="text-xs text-brand hover:underline"
                        onClick={() => setOpen(isOpen ? null : key)}
                      >
                        {isOpen ? "Hide" : "Lines"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={12} className="bg-gray-50 px-3 py-2">
                        {own.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            This supplier&apos;s invoices have no lines recorded.
                          </p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left uppercase text-gray-400">
                                <th className="py-1 pr-2">Date</th>
                                <th className="py-1 pr-2">Item</th>
                                <th className="py-1 pr-2 text-right">Qty</th>
                                <th className="py-1 pr-2 text-right">
                                  Unit price
                                </th>
                                <th className="py-1 pr-2 text-right">Net</th>
                                <th className="py-1 pr-2">Invoice</th>
                              </tr>
                            </thead>
                            <tbody>
                              {own.map((l) => (
                                <tr key={l.line_id}>
                                  <td className="py-1 pr-2 whitespace-nowrap">
                                    {fmtDate(l.date)}
                                  </td>
                                  <td className="py-1 pr-2">{l.description}</td>
                                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                                    {fmtQty(l.qty, l.unit)}
                                  </td>
                                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                                    {fmtUnitPrice(l.unit_price, l.unit)}
                                  </td>
                                  <td className="py-1 pr-2 text-right">
                                    {formatCurrency(l.line_net)}
                                  </td>
                                  <td className="py-1 pr-2">
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
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-semibold">
              <td className="py-2 pr-2" colSpan={2}>
                Total
              </td>
              <td className="py-2 pr-2 text-right">{totals.invoices}</td>
              <td />
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
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
