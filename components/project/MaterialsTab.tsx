"use client";

import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import type { MaterialLedgerRow } from "@/types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

// Imported rows may carry a "Supplier — note" description; the note is already
// shown in the Notes column, so display just the item/supplier part here.
function cleanItem(item: string): string {
  return item.replace(/\s+—\s+.*$/, "").trim();
}

export default function MaterialsTab({ rows }: { rows: MaterialLedgerRow[] }) {
  if (rows.length === 0)
    return (
      <EmptyState
        title="No materials yet"
        description="Add an expense with category = Materials and it will appear here automatically."
      />
    );

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total;
      acc.paid += r.paid;
      acc.remaining += r.remaining;
      return acc;
    },
    { total: 0, paid: 0, remaining: 0 }
  );

  return (
    <>
      {/* Mobile: one card per purchase. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">
                  {r.supplier && r.supplier !== "—"
                    ? r.supplier
                    : cleanItem(r.item)}
                </span>
                <p className="mt-0.5 text-xs text-gray-500">
                  Week {r.week_number}
                  {r.unit_cost > 0
                    ? ` · ${formatCurrency(r.unit_cost)}/unit`
                    : ""}
                  {r.qty ? ` × ${r.qty}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-semibold">
                {formatCurrency(r.total)}
              </span>
            </div>
            <div className="mt-2 flex justify-between border-t border-gray-100 pt-2 text-xs text-gray-500">
              <span>Paid {formatCurrency(r.paid)}</span>
              <span>
                {fmtDate(r.paid_date)}
                {r.payment_method ? ` · ${r.payment_method}` : ""}
              </span>
            </div>
            {r.notes ? (
              <p className="mt-1 text-xs text-gray-400">{r.notes}</p>
            ) : null}
          </div>
        ))}
        <div className="card p-3 text-sm">
          <div className="flex justify-between font-semibold">
            <span>Total ({rows.length} purchases)</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-500">
            <span>Paid</span>
            <span>{formatCurrency(totals.paid)}</span>
          </div>
        </div>
      </div>

      {/* Desktop: table. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-gray-500">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">Supplier</th>
            <th className="py-2 pr-2 text-right">Unit Cost (£)</th>
            <th className="py-2 pr-2 text-right">Qty</th>
            <th className="py-2 pr-2 text-right">Total (£)</th>
            <th className="py-2 pr-2 text-right">Paid (£)</th>
            <th className="py-2 pr-2">Date Paid</th>
            <th className="py-2 pr-2">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, i) => (
            <tr key={r.id} className="align-top">
              <td className="py-2 pr-2">{i + 1}</td>
              <td className="py-2 pr-2 font-medium">
                {r.supplier && r.supplier !== "—" ? r.supplier : cleanItem(r.item)}
              </td>
              <td className="py-2 pr-2 text-right">
                {r.unit_cost > 0 ? formatCurrency(r.unit_cost) : "—"}
              </td>
              <td className="py-2 pr-2 text-right">{r.qty || "—"}</td>
              <td className="py-2 pr-2 text-right font-medium">
                {formatCurrency(r.total)}
              </td>
              <td className="py-2 pr-2 text-right">{formatCurrency(r.paid)}</td>
              <td className="py-2 pr-2 whitespace-nowrap">
                {fmtDate(r.paid_date)}
                {r.payment_method ? (
                  <p className="text-xs text-gray-400">{r.payment_method}</p>
                ) : null}
              </td>
              <td className="py-2 pr-2 max-w-xs text-xs text-gray-500">
                {r.notes || "—"}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 font-semibold">
            <td className="py-2 pr-2" colSpan={4}>
              Total ({rows.length} purchases)
            </td>
            <td className="py-2 pr-2 text-right">{formatCurrency(totals.total)}</td>
            <td className="py-2 pr-2 text-right">{formatCurrency(totals.paid)}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
        </table>
      </div>
    </>
  );
}
