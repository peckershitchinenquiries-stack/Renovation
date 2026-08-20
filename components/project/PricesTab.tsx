"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import { fmtDate, fmtQty, fmtUnitPrice } from "@/components/project/format";
import type { ItemPriceRow } from "@/types";

// The Price Tracker, rebuilt on invoice lines.
//
// It used to read `expense_entries.unit_cost`, which the week-by-week
// spreadsheet almost never filled in — so the screen was empty even when there
// was plenty of spend. An invoice line always carries qty, unit and price each,
// so this now has something real to compare.
//
// One rule the old version did not have: a percentage is only shown when both
// prices are per the SAME unit. "£12 a bag" against "£12 a tonne" is not a 0%
// change, so PriceMoveBadge renders that case as a unit change instead of a
// number.

export default function PricesTab({
  projectId,
  rows,
  hasLines,
}: {
  projectId: string;
  rows: ItemPriceRow[];
  // True when the project has invoice lines but none of them recorded a price
  // per unit — a different situation from having no invoices at all, and worth
  // saying so rather than showing the same empty state.
  hasLines: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0)
    return (
      <EmptyState
        title={hasLines ? "No unit prices recorded yet" : "No price history yet"}
        description={
          hasLines
            ? "This project's invoice lines have a total but no price per unit, so there is nothing to compare. Add the quantity and unit price to a line and it will start a price history."
            : "Log an invoice with its lines — quantity, unit and price each — and the same item bought twice will be compared here."
        }
        action={
          <Link href="/invoices" className="btn-primary">
            Log an invoice
          </Link>
        }
      />
    );

  const repeats = rows.filter((r) => r.purchase_count > 1).length;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        The price per unit of each item across every invoice on this project — so
        you can see when the same thing costs more than last time.{" "}
        {repeats > 0
          ? `${repeats} ${repeats === 1 ? "item has" : "items have"} been bought more than once.`
          : "Nothing has been bought twice yet, so there is nothing to compare against."}
      </p>

      {/* Mobile: one card per item, expandable to the full history. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((it) => {
          const key = it.item_id ?? it.item;
          const isOpen = open === key;
          return (
            <div key={key} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{it.item}</span>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {it.suppliers.join(", ")}
                  </p>
                </div>
                <span className="shrink-0 text-right text-sm">
                  <PriceMoveBadge
                    move={it.trend}
                    deltaPct={it.latest_delta_pct}
                    unit={it.points[it.points.length - 1]?.unit}
                    previousUnit={
                      it.points[it.points.length - 1]?.previous_unit
                    }
                  />
                </span>
              </div>
              <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
                <span>
                  First {fmtUnitPrice(it.first_price, it.units[0] ?? null)} →
                  latest{" "}
                  <span className="font-medium text-gray-900">
                    {fmtUnitPrice(
                      it.latest_price,
                      it.points[it.points.length - 1]?.unit ?? null
                    )}
                  </span>
                </span>
                <span>
                  {it.purchase_count} {it.purchase_count === 1 ? "buy" : "buys"}
                </span>
              </div>
              {it.purchase_count > 1 && (
                <>
                  <button
                    type="button"
                    className="mt-2 text-sm text-brand"
                    onClick={() => setOpen(isOpen ? null : key)}
                  >
                    {isOpen ? "Hide history" : "Show history"}
                  </button>
                  {isOpen && (
                    <ul className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs">
                      {it.points.map((p) => (
                        <li key={p.line_id} className="flex justify-between gap-2">
                          <span className="text-gray-500">
                            {fmtDate(p.date)} · {p.supplier}
                          </span>
                          <span className="whitespace-nowrap">
                            {fmtUnitPrice(p.unit_price, p.unit)}{" "}
                            <PriceMoveBadge
                              move={p.move}
                              deltaPct={p.delta_pct}
                              unit={p.unit}
                              previousUnit={p.previous_unit}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Suppliers</th>
              <th className="py-2 pr-2 text-right">Buys</th>
              <th className="py-2 pr-2 text-right">Qty bought</th>
              <th className="py-2 pr-2 text-right">First price</th>
              <th className="py-2 pr-2 text-right">Latest price</th>
              <th className="py-2 pr-2 text-right">Latest change</th>
              <th className="py-2 pr-2 text-right">Spent (net)</th>
              <th className="py-2 pr-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((it) => {
              const key = it.item_id ?? it.item;
              const isOpen = open === key;
              const latest = it.points[it.points.length - 1];
              return (
                <Fragment key={key}>
                  <tr className="align-top">
                    <td className="py-2 pr-2">
                      {it.item_id ? (
                        <Link
                          href={`/items/${it.item_id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {it.item}
                        </Link>
                      ) : (
                        <span className="font-medium">{it.item}</span>
                      )}
                      {/* Two different units means the "first → latest"
                          comparison spans a pack-size change. Say so. */}
                      {it.units.length > 1 && (
                        <p className="text-xs text-amber-700">
                          bought in {it.units.join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-2 max-w-xs text-xs text-gray-500">
                      {it.suppliers.join(", ")}
                    </td>
                    <td className="py-2 pr-2 text-right">{it.purchase_count}</td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {fmtQty(it.total_qty, it.units.length === 1 ? it.units[0] : null)}
                    </td>
                    <td className="py-2 pr-2 text-right whitespace-nowrap">
                      {fmtUnitPrice(it.first_price, it.units[0] ?? null)}
                    </td>
                    <td className="py-2 pr-2 text-right font-medium whitespace-nowrap">
                      {fmtUnitPrice(it.latest_price, latest?.unit ?? null)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <PriceMoveBadge
                        move={it.trend}
                        deltaPct={it.latest_delta_pct}
                        unit={latest?.unit}
                        previousUnit={latest?.previous_unit}
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(it.total_net)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {it.purchase_count > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-brand hover:underline"
                          onClick={() => setOpen(isOpen ? null : key)}
                        >
                          {isOpen ? "Hide" : "History"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} className="bg-gray-50 px-3 py-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left uppercase text-gray-400">
                              <th className="py-1 pr-2">Date</th>
                              <th className="py-1 pr-2">Supplier</th>
                              <th className="py-1 pr-2">Invoice</th>
                              <th className="py-1 pr-2 text-right">Qty</th>
                              <th className="py-1 pr-2 text-right">Unit price</th>
                              <th className="py-1 pr-2 text-right">Net</th>
                              <th className="py-1 pr-2 text-right">vs previous</th>
                            </tr>
                          </thead>
                          <tbody>
                            {it.points.map((p) => (
                              <tr key={p.line_id}>
                                <td className="py-1 pr-2 whitespace-nowrap">
                                  {fmtDate(p.date)}
                                </td>
                                <td className="py-1 pr-2">{p.supplier}</td>
                                <td className="py-1 pr-2">
                                  <Link
                                    href={`/projects/${projectId}/purchases/${p.purchase_id}/edit`}
                                    className="text-brand hover:underline"
                                  >
                                    {p.invoice_no || "view"}
                                  </Link>
                                </td>
                                <td className="py-1 pr-2 text-right whitespace-nowrap">
                                  {fmtQty(p.qty, p.unit)}
                                </td>
                                <td className="py-1 pr-2 text-right whitespace-nowrap">
                                  {fmtUnitPrice(p.unit_price, p.unit)}
                                </td>
                                <td className="py-1 pr-2 text-right">
                                  {formatCurrency(p.line_net)}
                                </td>
                                <td className="py-1 pr-2 text-right">
                                  <PriceMoveBadge
                                    move={p.move}
                                    deltaPct={p.delta_pct}
                                    unit={p.unit}
                                    previousUnit={p.previous_unit}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
