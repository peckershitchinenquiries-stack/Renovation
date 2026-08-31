"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { EmptyState } from "@/components/ui/States";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import { combineTotals } from "@/components/purchases/totals";
import PivotTable, { type PivotColumn } from "@/components/project/PivotTable";
import type { ItemListRow, SupplierListRow } from "@/types";

/**
 * Directory — everyone bought from and everything bought, across every project.
 *
 * Suppliers and Items were two nav destinations holding the same kind of thing:
 * a cross-project register of one dimension of the transaction core (about.md
 * §4.6). They are one destination with a pivot now, on the same table shell as
 * the project screen's Analysis tab.
 *
 * The scope control is the link that was missing. This page and the project
 * screen's Analysis tab are the same question at two scopes — "what have I ever
 * spent with Lawsons" and "what has this job bought from Lawsons" — and until
 * now neither mentioned the other existed. Picking a project here goes to that
 * project's Analysis pivot.
 *
 * Note what the scope control does NOT do: filter this page. `getSuppliers()`
 * and `getItems()` return totals split by `entry_source` with no project
 * attribution, so a real "this project" filter needs a new loader. That is a
 * data change, not a presentation one — so the control navigates instead.
 */

export type DirectoryView = "suppliers" | "items";

const VIEWS: { value: DirectoryView; label: string }[] = [
  { value: "suppliers", label: "Suppliers" },
  { value: "items", label: "Items" },
];

// `row.totals` still arrives split by entry_source; combineTotals adds it up
// for display, and explains there why that is safe today.
const totalSpend = (row: SupplierListRow) => combineTotals(row.totals)?.gross ?? 0;
const totalOwed = (row: SupplierListRow) => combineTotals(row.totals)?.balance ?? 0;

export default function DirectoryScreen({
  view,
  suppliers,
  items,
  projects,
}: {
  view: DirectoryView;
  suppliers: SupplierListRow[] | null;
  items: ItemListRow[] | null;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const count = view === "suppliers" ? suppliers?.length ?? 0 : items?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Directory"
        subtitle={`${count} ${
          view === "suppliers"
            ? count === 1
              ? "supplier"
              : "suppliers"
            : count === 1
              ? "item"
              : "items"
        } across every project`}
        below={
          <SegmentedControl
            fill
            label="Show"
            value={view}
            onChange={(next) => router.push(`/directory?view=${next}`)}
            options={VIEWS}
          />
        }
      />

      {/*
        The scope jump. This is a navigation control, not a filter — see the
        note at the top of this file — so it reads as one: a labelled row that
        goes somewhere, rather than a `<select>` sitting in a filter position
        and quietly teleporting you when touched.
      */}
      <div className="mb-3">
        <Select
          placeholder="Narrow to one project"
          title="Open one project's analysis"
          value=""
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => {
            if (!id) return;
            router.push(
              `/projects/${id}?tab=analysis&view=${
                view === "suppliers" ? "supplier" : "price"
              }`
            );
          }}
        />
        <p className="hint">
          Opens that project&apos;s Analysis tab. This page always shows every
          project.
        </p>
      </div>

      {view === "suppliers" ? (
        <SupplierDirectory rows={suppliers ?? []} />
      ) : (
        <ItemDirectory rows={items ?? []} />
      )}
    </div>
  );
}

function SupplierDirectory({ rows }: { rows: SupplierListRow[] }) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon="store"
        title="No suppliers yet"
        description="Suppliers are created from your existing cost rows by migration 0008. If you have expenses recorded but nothing here, that migration has not been run in the Supabase SQL editor."
      />
    );

  const columns: PivotColumn<SupplierListRow>[] = [
    {
      key: "supplier",
      header: "Supplier",
      cell: (row) => (
        <Link
          href={`/suppliers/${row.supplier.id}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {row.supplier.name}
        </Link>
      ),
    },
    {
      key: "records",
      header: "Records",
      align: "right",
      cell: (row) => row.purchase_count,
    },
    {
      key: "spend",
      header: MONEY.cost.label,
      title: MONEY.cost.hint,
      align: "right",
      cell: (row) => formatCurrency(totalSpend(row)),
    },
    {
      key: "owed",
      header: MONEY.owed.label,
      title: MONEY.owed.hint,
      align: "right",
      cell: (row) => formatCurrency(totalOwed(row)),
    },
    {
      key: "last",
      header: "Last purchase",
      cell: (row) => row.last_purchase_date || "—",
    },
  ];

  return (
    <PivotTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.supplier.id}
      card={(row) => (
        <Link
          href={`/suppliers/${row.supplier.id}`}
          className="card block transition active:scale-[0.99]"
        >
          <div className="flex items-start gap-3">
            <IconTile name="store" tone="brand" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {row.supplier.name}
              </span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {row.purchase_count}{" "}
                {row.purchase_count === 1 ? "record" : "records"} · last{" "}
                {row.last_purchase_date || "—"}
              </span>
            </div>
            <Icon
              name="chevronRight"
              size={18}
              className="mt-1.5 shrink-0 text-gray-300"
            />
          </div>
          <dl className="mt-2.5 grid grid-cols-2 gap-2 border-t border-gray-200/70 pt-2.5">
            <div>
              <dt className="text-2xs font-medium text-gray-400">
                {MONEY.cost.label}
              </dt>
              <dd className="tnum mt-0.5 text-[0.9375rem] font-bold text-gray-900">
                {formatCurrency(totalSpend(row))}
              </dd>
            </div>
            <div>
              <dt className="text-2xs font-medium text-gray-400">
                {MONEY.owed.label}
              </dt>
              <dd
                className={`tnum mt-0.5 text-[0.9375rem] font-bold ${
                  totalOwed(row) > 0.001 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {formatCurrency(totalOwed(row))}
              </dd>
            </div>
          </dl>
        </Link>
      )}
    />
  );
}

function ItemDirectory({ rows }: { rows: ItemListRow[] }) {
  if (rows.length === 0)
    return (
      <EmptyState
        icon="package"
        title="No items yet"
        description="Items are created from your existing cost descriptions by migration 0008. If you have expenses recorded but nothing here, that migration has not been run in the Supabase SQL editor."
      />
    );

  // A blank unit price means the source never recorded one — the week-by-week
  // plan has no quantity or unit-cost column, so its rows carry no price per
  // unit. Said in the cell rather than in a paragraph above the table.
  const trend = (row: ItemListRow) =>
    row.latest_unit_price === null ? (
      <span className="text-xs text-gray-400">no unit price</span>
    ) : (
      <PriceMoveBadge move={row.trend} deltaPct={row.latest_delta_pct} />
    );

  const columns: PivotColumn<ItemListRow>[] = [
    {
      key: "item",
      header: "Item",
      cell: (row) => (
        <Link
          href={`/items/${row.item.id}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {row.item.canonical_name}
        </Link>
      ),
    },
    { key: "category", header: "Category", cell: (row) => row.item.category || "—" },
    { key: "unit", header: "Unit", cell: (row) => row.item.default_unit || "—" },
    { key: "qty", header: "QTY", align: "right", cell: (row) => row.line_count },
    {
      key: "price",
      header: "Latest unit price",
      align: "right",
      cell: (row) => (
        <span className="font-medium">
          {row.latest_unit_price === null
            ? "—"
            : formatCurrency(row.latest_unit_price)}
        </span>
      ),
    },
    { key: "trend", header: "Trend", cell: trend },
    {
      key: "last",
      header: "Last bought",
      cell: (row) => row.last_purchase_date || "—",
    },
  ];

  return (
    <PivotTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.item.id}
      card={(row) => (
        <Link
          href={`/items/${row.item.id}`}
          className="card block transition active:scale-[0.99]"
        >
          <div className="flex items-start gap-3">
            <IconTile name="package" tone="info" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {row.item.canonical_name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-gray-500">
                {row.item.category || "Uncategorised"} · {row.line_count}{" "}
                {row.line_count === 1 ? "line" : "lines"} · last{" "}
                {row.last_purchase_date || "—"}
              </span>
            </div>
            <Icon
              name="chevronRight"
              size={18}
              className="mt-1.5 shrink-0 text-gray-300"
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-gray-200/70 pt-2.5">
            <div>
              <p className="text-2xs font-medium text-gray-400">
                Latest unit price
              </p>
              <p className="tnum mt-0.5 text-[0.9375rem] font-bold text-gray-900">
                {row.latest_unit_price === null
                  ? "—"
                  : formatCurrency(row.latest_unit_price)}
                {row.item.default_unit ? (
                  <span className="text-xs font-medium text-gray-400">
                    /{row.item.default_unit}
                  </span>
                ) : null}
              </p>
            </div>
            <span className="shrink-0">{trend(row)}</span>
          </div>
        </Link>
      )}
    />
  );
}
