import Link from "next/link";
import { getItems } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";

export const dynamic = "force-dynamic";

export default async function ItemsPage() {
  const rows = await getItems();

  if (rows.length === 0)
    return (
      <div>
        <h1 className="mb-4 text-xl font-bold text-gray-900 sm:text-2xl">
          Items
        </h1>
        <EmptyState
          title="No items yet"
          description="Items are created from your existing cost descriptions by migration 0008. If you have expenses recorded but nothing here, that migration has not been run in the Supabase SQL editor."
        />
      </div>
    );

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Items</h1>
        <span className="text-sm text-gray-500">{rows.length} items</span>
      </div>
      <p className="mb-3 text-sm text-gray-500">
        Every material you have bought, across all suppliers and projects.
        Labour items are excluded — open one for its full price history.
      </p>
      <p className="mb-3 text-xs text-gray-500">
        A blank unit price means the source never recorded one — the
        week-by-week plan has no quantity or unit-cost column, so its rows carry
        no price per unit.
      </p>

      {/* Mobile: one card per item. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <Link
            key={row.item.id}
            href={`/items/${row.item.id}`}
            className="card block p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-medium text-gray-900">
                {row.item.canonical_name}
              </span>
              <span className="shrink-0 text-right text-sm">
                {row.latest_unit_price === null ? (
                  <span className="text-xs text-gray-400">no unit price</span>
                ) : (
                  <PriceMoveBadge
                    move={row.trend}
                    deltaPct={row.latest_delta_pct}
                  />
                )}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
              <dt className="text-gray-500">Category</dt>
              <dd className="text-right">{row.item.category || "—"}</dd>
              <dt className="text-gray-500">QTY</dt>
              <dd className="text-right">{row.line_count}</dd>
              <dt className="text-gray-500">Latest unit price</dt>
              <dd className="text-right">
                {row.latest_unit_price === null
                  ? "—"
                  : formatCurrency(row.latest_unit_price)}
              </dd>
              <dt className="text-gray-500">Last bought</dt>
              <dd className="text-right">{row.last_purchase_date || "—"}</dd>
            </dl>
          </Link>
        ))}
      </div>

      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Category</th>
              <th className="py-2 pr-2">Unit</th>
              <th className="py-2 pr-2 text-right">QTY</th>
              <th className="py-2 pr-2 text-right">Latest unit price</th>
              <th className="py-2 pr-2">Trend</th>
              <th className="py-2 pr-2">Last bought</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.item.id}>
                <td className="py-2 pr-2 font-medium">
                  <Link
                    href={`/items/${row.item.id}`}
                    className="text-brand hover:underline"
                  >
                    {row.item.canonical_name}
                  </Link>
                </td>
                <td className="py-2 pr-2">{row.item.category || "—"}</td>
                <td className="py-2 pr-2">{row.item.default_unit || "—"}</td>
                <td className="py-2 pr-2 text-right">{row.line_count}</td>
                <td className="py-2 pr-2 text-right font-medium">
                  {row.latest_unit_price === null
                    ? "—"
                    : formatCurrency(row.latest_unit_price)}
                </td>
                <td className="py-2 pr-2">
                  {row.latest_unit_price === null ? (
                    <span className="text-xs text-gray-400">no unit price</span>
                  ) : (
                    <PriceMoveBadge
                      move={row.trend}
                      deltaPct={row.latest_delta_pct}
                    />
                  )}
                </td>
                <td className="py-2 pr-2">{row.last_purchase_date || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
