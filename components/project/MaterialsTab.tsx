"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import { fmtDate, fmtQty, fmtUnitPrice } from "@/components/project/format";
import type { InvoiceLineView } from "@/types";

// Materials, split out of the old "Materials & Suppliers" tab — Suppliers is
// now its own screen.
//
// One row per invoice line, which is the whole point of moving off the
// spreadsheet: a line records what was bought, how many, in what unit and at
// what price each. That is what the Price Tracker compares, and it is what the
// old data was missing.

export default function MaterialsTab({
  projectId,
  lines,
}: {
  projectId: string;
  lines: InvoiceLineView[];
}) {
  const [query, setQuery] = useState("");
  const [supplier, setSupplier] = useState("");

  const suppliers = useMemo(
    () => [...new Set(lines.map((l) => l.supplier))].sort((a, b) => a.localeCompare(b)),
    [lines]
  );

  const uncategorised = useMemo(
    () => lines.filter((l) => l.category === null).length,
    [lines]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (supplier && l.supplier !== supplier) return false;
      if (!q) return true;
      return (
        l.description.toLowerCase().includes(q) ||
        l.item_name.toLowerCase().includes(q) ||
        (l.invoice_no ?? "").toLowerCase().includes(q)
      );
    });
  }, [lines, query, supplier]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, l) => {
          acc.net += l.line_net;
          acc.vat += l.vat_amount;
          acc.gross += l.line_gross;
          return acc;
        },
        { net: 0, vat: 0, gross: 0 }
      ),
    [filtered]
  );

  if (lines.length === 0)
    return (
      <EmptyState
        title="No materials yet"
        description="Materials appear here line by line as soon as an invoice is filed with its category set to Materials."
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Every material line bought for this project, straight off the invoices.
        Quantity and price per unit are what the{" "}
        <span className="font-medium">Price Tracker</span> compares.
      </p>

      {/* Category is optional on an invoice and the extractor does not set it,
          so lines arrive uncategorised. They are listed here rather than
          hidden — but say which ones they are, so the split against Labour can
          be corrected on the invoice. */}
      {uncategorised > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {uncategorised} of these {uncategorised === 1 ? "line has" : "lines have"}{" "}
          no category set on {uncategorised === 1 ? "its" : "their"} invoice.
          They are counted as materials here. Set the category on the invoice if
          any of them is really labour.
        </p>
      )}

      <div className="card flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label className="label" htmlFor="materials-search">
            Search
          </label>
          <input
            id="materials-search"
            className="input"
            placeholder="Item or invoice number"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="materials-supplier">
            Supplier
          </label>
          <select
            id="materials-supplier"
            className="input w-44"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
          >
            <option value="">All</option>
            {suppliers.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {(query || supplier) && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setQuery("");
              setSupplier("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches"
          description="No material line matches that search on this project."
        />
      ) : (
        <>
          {/* Mobile: one card per line. */}
          <div className="space-y-2 sm:hidden">
            {filtered.map((l) => (
              <div key={l.line_id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium">{l.description}</span>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {l.supplier}
                      {l.week_no ? ` · week ${l.week_no}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold">
                    {formatCurrency(l.line_gross)}
                  </span>
                </div>
                <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
                  <span>
                    {fmtQty(l.qty, l.unit)}
                    {l.unit_price > 0
                      ? ` @ ${fmtUnitPrice(l.unit_price, l.unit)}`
                      : ""}
                  </span>
                  <span>
                    {fmtDate(l.date)}
                    {l.invoice_no ? ` · ${l.invoice_no}` : ""}
                  </span>
                </div>
              </div>
            ))}
            <div className="card p-3 text-sm">
              <div className="flex justify-between font-semibold">
                <span>
                  Total ({filtered.length}{" "}
                  {filtered.length === 1 ? "line" : "lines"})
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
                  <th className="py-2 pr-2">Item</th>
                  <th className="py-2 pr-2">Supplier</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2 text-right">Unit price</th>
                  <th className="py-2 pr-2 text-right">Net</th>
                  <th className="py-2 pr-2 text-right">VAT</th>
                  <th className="py-2 pr-2 text-right">Total</th>
                  <th className="py-2 pr-2">Invoice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((l) => (
                  <tr key={l.line_id} className="align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {fmtDate(l.date)}
                    </td>
                    <td className="py-2 pr-2">{l.week_no ?? "—"}</td>
                    <td className="py-2 pr-2">
                      <span className="font-medium">{l.description}</span>
                      {/* Only worth showing when the line was filed under a
                          different spelling — that is the match the price
                          history is grouped on. */}
                      {l.item_id && l.item_name !== l.description && (
                        <p className="text-xs text-gray-400">
                          filed as {l.item_name}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      {l.supplier_id ? (
                        <Link
                          href={`/suppliers/${l.supplier_id}`}
                          className="text-brand hover:underline"
                        >
                          {l.supplier}
                        </Link>
                      ) : (
                        <span className="text-gray-400">{l.supplier}</span>
                      )}
                    </td>
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
                  <td className="py-2 pr-2" colSpan={6}>
                    Total ({filtered.length}{" "}
                    {filtered.length === 1 ? "line" : "lines"})
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
        </>
      )}
    </div>
  );
}
