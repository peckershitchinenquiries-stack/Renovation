"use client";

import { Fragment, useState } from "react";
import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import type { PriceHistoryItem, PriceDirection } from "@/types";

function TrendBadge({
  direction,
  deltaPct,
}: {
  direction: PriceDirection;
  deltaPct: number;
}) {
  if (direction === "first")
    return <span className="text-xs text-gray-400">first buy</span>;
  if (direction === "up")
    return (
      <span className="font-medium text-red-600">
        ▲ +{deltaPct.toFixed(1)}%
      </span>
    );
  if (direction === "down")
    return (
      <span className="font-medium text-emerald-600">
        ▼ {deltaPct.toFixed(1)}%
      </span>
    );
  return <span className="text-gray-500">no change</span>;
}

export default function PricesTab({ items }: { items: PriceHistoryItem[] }) {
  const [open, setOpen] = useState<string | null>(null);

  if (items.length === 0)
    return (
      <EmptyState
        title="No price history yet"
        description="Add material expenses with a Qty and Unit Cost to track whether the same item costs more over time."
      />
    );

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Tracks the unit price of each material across purchases — so you can spot
        when the same item costs more than last time.
      </p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2 text-right">Buys</th>
              <th className="py-2 pr-2 text-right">First Price</th>
              <th className="py-2 pr-2 text-right">Latest Price</th>
              <th className="py-2 pr-2 text-right">Latest Change</th>
              <th className="py-2 pr-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((it) => {
              const isOpen = open === it.item;
              return (
                <Fragment key={it.item}>
                  <tr className="align-top">
                    <td className="py-2 pr-2 font-medium">{it.item}</td>
                    <td className="py-2 pr-2 text-right">{it.purchase_count}</td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(it.first_price)}
                    </td>
                    <td className="py-2 pr-2 text-right font-medium">
                      {formatCurrency(it.latest_price)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <TrendBadge
                        direction={it.trend}
                        deltaPct={it.latest_delta_pct}
                      />
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {it.purchase_count > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-brand hover:underline"
                          onClick={() => setOpen(isOpen ? null : it.item)}
                        >
                          {isOpen ? "Hide" : "History"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 px-3 py-2">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left uppercase text-gray-400">
                              <th className="py-1 pr-2">Date</th>
                              <th className="py-1 pr-2">Supplier</th>
                              <th className="py-1 pr-2 text-right">Unit Cost</th>
                              <th className="py-1 pr-2 text-right">Qty</th>
                              <th className="py-1 pr-2 text-right">Total</th>
                              <th className="py-1 pr-2 text-right">vs Prev</th>
                            </tr>
                          </thead>
                          <tbody>
                            {it.purchases.map((p, i) => (
                              <tr key={i}>
                                <td className="py-1 pr-2">{p.date || "—"}</td>
                                <td className="py-1 pr-2">{p.supplier || "—"}</td>
                                <td className="py-1 pr-2 text-right">
                                  {formatCurrency(p.unit_cost)}
                                </td>
                                <td className="py-1 pr-2 text-right">{p.qty}</td>
                                <td className="py-1 pr-2 text-right">
                                  {formatCurrency(p.total)}
                                </td>
                                <td className="py-1 pr-2 text-right">
                                  <TrendBadge
                                    direction={p.direction}
                                    deltaPct={p.delta_pct}
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
