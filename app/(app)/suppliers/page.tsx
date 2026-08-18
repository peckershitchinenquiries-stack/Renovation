import Link from "next/link";
import { getSuppliers } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { EmptyState } from "@/components/ui/States";
import { SourceNote } from "@/components/purchases/SourceNote";
import type { PurchaseEntrySource, SupplierListRow } from "@/types";

export const dynamic = "force-dynamic";

// Diary and ledger are reported in their own columns rather than summed —
// see SourceNote and about.md §5.
const totalFor = (row: SupplierListRow, source: PurchaseEntrySource) =>
  row.totals.find((t) => t.entry_source === source) ?? null;

const money = (value: number | undefined) =>
  value === undefined ? "—" : formatCurrency(value);

export default async function SuppliersPage() {
  const rows = await getSuppliers();

  if (rows.length === 0)
    return (
      <div>
        <h1 className="mb-4 text-xl font-bold text-gray-900 sm:text-2xl">
          Suppliers
        </h1>
        <EmptyState
          title="No suppliers yet"
          description="Suppliers are created from your existing cost rows by migration 0008. If you have expenses recorded but nothing here, that migration has not been run in the Supabase SQL editor."
        />
      </div>
    );

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">
          Suppliers
        </h1>
        <span className="text-sm text-gray-500">{rows.length} suppliers</span>
      </div>
      <p className="mb-3 text-sm text-gray-500">
        Everyone you have bought from, across all projects. Open one to see its
        purchases, what was paid and what is still owed.
      </p>
      <SourceNote className="mb-3" />

      {/* Mobile: one card per supplier. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => {
          const diary = totalFor(row, "diary");
          const ledger = totalFor(row, "ledger");
          return (
            <Link
              key={row.supplier.id}
              href={`/suppliers/${row.supplier.id}`}
              className="card block p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 font-medium text-gray-900">
                  {row.supplier.name}
                </span>
                <span className="shrink-0 text-xs text-gray-500">
                  {row.purchase_count}{" "}
                  {row.purchase_count === 1 ? "record" : "records"}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
                <dt className="text-gray-500">Diary spend</dt>
                <dd className="text-right">{money(diary?.gross)}</dd>
                <dt className="text-gray-500">Diary owed</dt>
                <dd className="text-right">{money(diary?.balance)}</dd>
                <dt className="text-gray-500">Ledger spend</dt>
                <dd className="text-right">{money(ledger?.gross)}</dd>
                <dt className="text-gray-500">Ledger owed</dt>
                <dd className="text-right">{money(ledger?.balance)}</dd>
                <dt className="text-gray-500">Last purchase</dt>
                <dd className="text-right">{row.last_purchase_date || "—"}</dd>
              </dl>
            </Link>
          );
        })}
      </div>

      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">Supplier</th>
              <th className="py-2 pr-2 text-right">Records</th>
              <th className="py-2 pr-2 text-right">Diary spend</th>
              <th className="py-2 pr-2 text-right">Diary owed</th>
              <th className="py-2 pr-2 text-right">Ledger spend</th>
              <th className="py-2 pr-2 text-right">Ledger owed</th>
              <th className="py-2 pr-2">Last purchase</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => {
              const diary = totalFor(row, "diary");
              const ledger = totalFor(row, "ledger");
              return (
                <tr key={row.supplier.id}>
                  <td className="py-2 pr-2 font-medium">
                    <Link
                      href={`/suppliers/${row.supplier.id}`}
                      className="text-brand hover:underline"
                    >
                      {row.supplier.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-2 text-right">{row.purchase_count}</td>
                  <td className="py-2 pr-2 text-right">{money(diary?.gross)}</td>
                  <td className="py-2 pr-2 text-right">
                    {money(diary?.balance)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(ledger?.gross)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {money(ledger?.balance)}
                  </td>
                  <td className="py-2 pr-2">{row.last_purchase_date || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
