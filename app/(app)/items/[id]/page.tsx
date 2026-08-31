import Link from "next/link";
import { notFound } from "next/navigation";
import { getItemBundle } from "@/lib/data";
import { formatCurrency } from "@/lib/calculations";
import { StatCard } from "@/components/ui/StatCard";
import { EmptyState } from "@/components/ui/States";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";

export const dynamic = "force-dynamic";

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

  // One set of figures for the item. getItemBundle still returns them split by
  // entry_source — that split is what stops a double-count if a second dataset
  // is ever imported alongside the invoices — but there is only one record set
  // to show, so the screen adds them up rather than showing a two-sided split
  // with one side missing.
  const spend = totals.reduce(
    (acc, t) => ({
      line_count: acc.line_count + t.line_count,
      qty: acc.qty + t.qty,
      net: acc.net + t.net,
    }),
    { line_count: 0, qty: 0, net: 0 }
  );

  return (
    <div>
      {/* Back goes to the Directory rather than the old /items route: they
          render the same list, and the Directory is what the bottom tab bar
          lights up. */}
      <PageHeader
        title={item.canonical_name}
        subtitle={
          [
            item.category,
            item.default_unit && `sold by the ${item.default_unit}`,
            item.pack_size && `${item.pack_size} ${item.pack_unit ?? ""}`.trim(),
          ]
            .filter(Boolean)
            .join(" · ") || "Price history across every supplier"
        }
        backHref="/directory?view=items"
        backLabel="All items"
      />

      <div className="space-y-5">
        {otherAliases.length > 0 ? (
          <p className="text-xs text-gray-500">
            Also written as: {otherAliases.map((a) => a.alias).join(", ")}
          </p>
        ) : null}

        {points.length === 0 ? (
          <EmptyState
            icon="package"
            title="Never bought"
            description="This item exists but no purchase line references it yet."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StatCard
                icon="package"
                label="Times bought"
                value={String(points.length)}
                hint={`${priced.length} with a unit price`}
              />
              <StatCard
                icon="chart"
                tone="brand"
                label="Latest unit price"
                value={latest ? formatCurrency(latest.unit_price) : "not recorded"}
                hint={latest?.date ?? undefined}
              />
              <StatCard
                icon="clock"
                label="First unit price"
                value={
                  priced[0] ? formatCurrency(priced[0].unit_price) : "not recorded"
                }
                hint={priced[0]?.date ?? undefined}
              />
              <StatCard
                icon="store"
                label="Suppliers"
                value={String(
                  new Set(points.map((p) => p.supplier_name).filter(Boolean)).size
                )}
              />
            </div>

            <div className="card">
              <p className="eyebrow">Bought in total</p>
              <dl className="mt-2.5 grid grid-cols-3 gap-2">
                <TotalCell label="Lines" value={String(spend.line_count)} />
                <TotalCell label="Qty" value={spend.qty ? String(spend.qty) : "—"} />
                <TotalCell
                  label="Net (ex VAT)"
                  value={formatCurrency(spend.net)}
                />
              </dl>
            </div>

            <section>
              <SectionHeader
                title="Every time it was bought"
                hint="Oldest first"
              />

              <p className="mb-3 flex items-start gap-2 rounded-2xl bg-gray-100 px-4 py-3 text-xs leading-relaxed text-gray-600">
                <Icon name="info" size={15} className="mt-0.5 shrink-0 text-gray-400" />
                <span>
                  Prices are compared against the previous purchase of this item
                  in the <em>same</em> unit. Where the unit changed, the change is
                  named instead of a percentage — a percentage across two
                  different units would not mean anything.
                </span>
              </p>

              {/* Mobile: one card per purchase, oldest first. */}
              <div className="space-y-2.5 sm:hidden">
                {points.map((p) => (
                  <div key={p.line_id} className="card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                          {p.unit_price > 0
                            ? formatCurrency(p.unit_price)
                            : "No unit price"}
                          {p.unit && p.unit_price > 0 ? (
                            <span className="text-xs font-medium text-gray-400">
                              /{p.unit}
                            </span>
                          ) : null}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          {p.date ? formatDisplayDate(p.date) : "No date"} ·{" "}
                          {p.supplier_id && p.supplier_name ? (
                            <Link
                              href={`/suppliers/${p.supplier_id}`}
                              className="font-semibold text-brand-700"
                            >
                              {p.supplier_name}
                            </Link>
                          ) : (
                            "no supplier"
                          )}
                        </p>
                      </div>
                      {p.unit_price > 0 ? (
                        <span className="shrink-0">
                          <PriceMoveBadge
                            move={p.move}
                            deltaPct={p.delta_pct}
                            unit={p.unit}
                            previousUnit={p.previous_unit}
                          />
                        </span>
                      ) : null}
                    </div>

                    {p.description_raw ? (
                      <p className="mt-1.5 truncate text-xs text-gray-500">
                        {p.description_raw}
                      </p>
                    ) : null}

                    <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-gray-200/70 pt-2.5">
                      <TotalCell
                        label="Qty"
                        value={`${p.qty > 0 ? p.qty : "—"} ${p.unit || ""}`.trim()}
                        flat
                      />
                      <TotalCell
                        label="Line net"
                        value={formatCurrency(p.line_net)}
                        flat
                      />
                      <TotalCell
                        label="Invoice"
                        value={p.invoice_no || "—"}
                        flat
                      />
                    </dl>
                    {p.project_name ? (
                      <p className="mt-2 truncate text-xs text-gray-400">
                        {p.project_name}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="card hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                      <th className="pb-2.5 pr-3">Date</th>
                      <th className="pb-2.5 pr-3">Supplier</th>
                      <th className="pb-2.5 pr-3">Project</th>
                      <th className="pb-2.5 pr-3">Invoice</th>
                      <th className="pb-2.5 pr-3 text-right">Qty</th>
                      <th className="pb-2.5 pr-3">Unit</th>
                      <th className="pb-2.5 pr-3 text-right">Unit price</th>
                      <th className="pb-2.5 pr-3 text-right">Line net</th>
                      <th className="pb-2.5">vs previous</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200/70">
                    {points.map((p) => (
                      <tr key={p.line_id} className="align-top">
                        <td className="tnum whitespace-nowrap py-2.5 pr-3 text-gray-600">
                          {p.date || <span className="text-gray-400">no date</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {p.supplier_id && p.supplier_name ? (
                            <Link
                              href={`/suppliers/${p.supplier_id}`}
                              className="font-semibold text-brand-700 hover:underline"
                            >
                              {p.supplier_name}
                            </Link>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {p.project_name || "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {p.invoice_no || "—"}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                          {p.qty > 0 ? p.qty : "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-gray-600">
                          {p.unit || "—"}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right font-bold text-gray-900">
                          {p.unit_price > 0 ? formatCurrency(p.unit_price) : "—"}
                        </td>
                        <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                          {formatCurrency(p.line_net)}
                        </td>
                        <td className="py-2.5">
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
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function TotalCell({
  label,
  value,
  flat = false,
}: {
  label: string;
  value: string;
  flat?: boolean;
}) {
  return (
    <div className={flat ? "min-w-0" : "min-w-0 rounded-xl bg-gray-100 px-3 py-2"}>
      <dt className="truncate text-2xs font-medium text-gray-500">{label}</dt>
      <dd className="tnum mt-0.5 truncate text-[0.8125rem] font-bold text-gray-900">
        {value}
      </dd>
    </div>
  );
}
