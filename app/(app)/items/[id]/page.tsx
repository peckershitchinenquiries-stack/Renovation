import Link from "next/link";
import { notFound } from "next/navigation";
import { getItemBundle } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import { SourceNote } from "@/components/purchases/SourceNote";

export const dynamic = "force-dynamic";

const SOURCE_LABEL = { diary: "Diary", ledger: "Ledger" } as const;

export default async function ItemPage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getItemBundle(params.id);
  if (!bundle) notFound();
  const { item, aliases, points, totals } = bundle;

  const otherAliases = aliases.filter((a) => a.alias !== item.canonical_name);
  const priced = points.filter((p) => p.unit_price > 0);
  const latest = priced[priced.length - 1] ?? null;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/items" className="text-sm text-brand hover:underline">
          ← All items
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900 sm:text-2xl">
          {item.canonical_name}
        </h1>
        <p className="text-sm text-gray-500">
          {[
            item.category,
            item.default_unit && `sold by the ${item.default_unit}`,
            item.pack_size && `${item.pack_size} ${item.pack_unit ?? ""}`.trim(),
          ]
            .filter(Boolean)
            .join(" · ") || "Price history across every supplier and project."}
        </p>
        {otherAliases.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">
            Also written as: {otherAliases.map((a) => a.alias).join(", ")}
          </p>
        )}
      </div>

      {points.length === 0 ? (
        <EmptyState
          title="Never bought"
          description="This item exists but no purchase line references it yet."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Times bought"
              value={String(points.length)}
              hint={`${priced.length} with a unit price`}
            />
            <StatCard
              label="Latest unit price"
              value={
                latest ? formatCurrency(latest.unit_price) : "not recorded"
              }
              hint={latest?.date ?? undefined}
            />
            <StatCard
              label="First unit price"
              value={
                priced[0] ? formatCurrency(priced[0].unit_price) : "not recorded"
              }
              hint={priced[0]?.date ?? undefined}
            />
            <StatCard
              label="Suppliers"
              value={String(
                new Set(points.map((p) => p.supplier_name).filter(Boolean)).size
              )}
            />
          </div>

          {/* Spend is split by source and never added up — see SourceNote. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {totals.map((t) => (
              <div key={t.entry_source} className="card">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {SOURCE_LABEL[t.entry_source]} records
                  </p>
                  <Badge label={t.entry_source} />
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-gray-500">Lines</dt>
                    <dd className="font-medium">{t.line_count}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Qty</dt>
                    <dd className="font-medium">{t.qty || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Net (ex VAT)</dt>
                    <dd className="font-medium">{formatCurrency(t.net)}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          <SourceNote />
          <p className="text-xs text-gray-500">
            Prices are compared only against the previous purchase in the{" "}
            <em>same</em> record set and in the <em>same</em> unit. Where the
            unit changed, the change is named instead of a percentage — a
            percentage across two different units would not mean anything.
          </p>

          {/* Mobile: one card per purchase, oldest first. */}
          <div className="space-y-2 sm:hidden">
            {points.map((p) => (
              <div key={p.line_id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {p.date || "no date"}
                    </p>
                    <p className="text-xs text-gray-500">
                      {p.supplier_id && p.supplier_name ? (
                        <Link
                          href={`/suppliers/${p.supplier_id}`}
                          className="text-brand hover:underline"
                        >
                          {p.supplier_name}
                        </Link>
                      ) : (
                        "no supplier"
                      )}
                    </p>
                  </div>
                  <Badge label={p.entry_source} />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {p.description_raw}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
                  <dt className="text-gray-500">Unit price</dt>
                  <dd className="text-right">
                    {p.unit_price > 0 ? formatCurrency(p.unit_price) : "—"}
                  </dd>
                  <dt className="text-gray-500">Qty / unit</dt>
                  <dd className="text-right">
                    {p.qty > 0 ? p.qty : "—"} {p.unit || ""}
                  </dd>
                  <dt className="text-gray-500">Line net</dt>
                  <dd className="text-right">{formatCurrency(p.line_net)}</dd>
                  <dt className="text-gray-500">Project</dt>
                  <dd className="text-right">{p.project_name || "—"}</dd>
                  <dt className="text-gray-500">Invoice</dt>
                  <dd className="text-right">{p.invoice_no || "—"}</dd>
                  <dt className="text-gray-500">vs previous</dt>
                  <dd className="text-right">
                    {p.unit_price > 0 ? (
                      <PriceMoveBadge
                        move={p.move}
                        deltaPct={p.delta_pct}
                        unit={p.unit}
                        previousUnit={p.previous_unit}
                      />
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </dd>
                </dl>
              </div>
            ))}
          </div>

          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2 pr-2">Supplier</th>
                  <th className="py-2 pr-2">Project</th>
                  <th className="py-2 pr-2">Invoice</th>
                  <th className="py-2 pr-2 text-right">Qty</th>
                  <th className="py-2 pr-2">Unit</th>
                  <th className="py-2 pr-2 text-right">Unit price</th>
                  <th className="py-2 pr-2 text-right">Line net</th>
                  <th className="py-2 pr-2">vs previous</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {points.map((p) => (
                  <tr key={p.line_id} className="align-top">
                    <td className="whitespace-nowrap py-2 pr-2">
                      {p.date || <span className="text-gray-400">no date</span>}
                    </td>
                    <td className="py-2 pr-2">
                      <Badge label={p.entry_source} />
                    </td>
                    <td className="py-2 pr-2">
                      {p.supplier_id && p.supplier_name ? (
                        <Link
                          href={`/suppliers/${p.supplier_id}`}
                          className="text-brand hover:underline"
                        >
                          {p.supplier_name}
                        </Link>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-2">{p.project_name || "—"}</td>
                    <td className="py-2 pr-2">{p.invoice_no || "—"}</td>
                    <td className="py-2 pr-2 text-right">
                      {p.qty > 0 ? p.qty : "—"}
                    </td>
                    <td className="py-2 pr-2">{p.unit || "—"}</td>
                    <td className="py-2 pr-2 text-right font-medium">
                      {p.unit_price > 0 ? formatCurrency(p.unit_price) : "—"}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(p.line_net)}
                    </td>
                    <td className="py-2 pr-2">
                      {p.unit_price > 0 ? (
                        <PriceMoveBadge
                          move={p.move}
                          deltaPct={p.delta_pct}
                          unit={p.unit}
                          previousUnit={p.previous_unit}
                        />
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
