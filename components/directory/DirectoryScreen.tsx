"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { expiryTone } from "@/lib/certifications";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Sheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import { combineTotals } from "@/components/purchases/totals";
import PivotTable, { type PivotColumn } from "@/components/project/PivotTable";
import ContactForm from "@/components/forms/ContactForm";
import type { ContactListRow, ItemListRow, SupplierListRow } from "@/types";

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

export type DirectoryView = "suppliers" | "items" | "people";

const VIEWS: { value: DirectoryView; label: string }[] = [
  { value: "suppliers", label: "Suppliers" },
  { value: "items", label: "Items" },
  // The third half (migration 0020). A worker is not a supplier — labour is
  // logged against a person's name with no supplier row created (about.md
  // §6.6.1) — so people are their own register rather than rows in the
  // merchant list, but they are the same *kind* of thing: a cross-project
  // register that sits above any one job.
  { value: "people", label: "People" },
];

const NOUN: Record<DirectoryView, [string, string]> = {
  suppliers: ["supplier", "suppliers"],
  items: ["item", "items"],
  people: ["person", "people"],
};

// `row.totals` still arrives split by entry_source; combineTotals adds it up
// for display, and explains there why that is safe today.
const totalSpend = (row: SupplierListRow) => combineTotals(row.totals)?.gross ?? 0;
const totalOwed = (row: SupplierListRow) => combineTotals(row.totals)?.balance ?? 0;

export default function DirectoryScreen({
  view,
  suppliers,
  items,
  contacts,
  projects,
}: {
  view: DirectoryView;
  suppliers: SupplierListRow[] | null;
  items: ItemListRow[] | null;
  // Null means migration 0020 has not been run — which is a different thing
  // from "nobody has been added yet", and the screen says which.
  contacts: ContactListRow[] | null;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const count =
    view === "suppliers"
      ? suppliers?.length ?? 0
      : view === "items"
        ? items?.length ?? 0
        : contacts?.length ?? 0;
  const [singular, plural] = NOUN[view];

  return (
    <div>
      <PageHeader
        title="Directory"
        subtitle={`${count} ${count === 1 ? singular : plural} across every project`}
        action={
          // Suppliers and items are created as a side effect of logging an
          // invoice (lib/purchaseWrite.ts) and have never needed an Add
          // button. A person is not: nothing in the money half creates one, so
          // People is the only segment that carries one.
          view === "people" && contacts !== null ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn btn-primary btn-sm"
            >
              <Icon name="plus" size={16} />
              Add
            </button>
          ) : null
        }
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

        Hidden on People: a person is not a pivot of one project's invoice
        lines, so there is nowhere for it to go. A control that does nothing on
        one segment is worse than one that is not there.
      */}
      {view !== "people" ? (
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
      ) : null}

      {view === "suppliers" ? (
        <SupplierDirectory rows={suppliers ?? []} />
      ) : view === "items" ? (
        <ItemDirectory rows={items ?? []} />
      ) : (
        <PeopleDirectory rows={contacts} onAdd={() => setAdding(true)} />
      )}

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add someone"
        description="A subcontractor, a tradesman, an architect — anyone who works on the job."
        size="lg"
      >
        <ContactForm
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
          onCancel={() => setAdding(false)}
        />
      </Sheet>
    </div>
  );
}

/**
 * The people register.
 *
 * The certificate chip is the reason this screen exists. A phone number saves
 * a minute; public liability that lapsed in March, on a job that is still
 * running, is a real problem — so the expiry state is on the row itself and
 * not behind a tap.
 */
function PeopleDirectory({
  rows,
  onAdd,
}: {
  rows: ContactListRow[] | null;
  onAdd: () => void;
}) {
  // Null and empty are different answers and the screen says which. An empty
  // list on an uninstalled table is exactly the ambiguity about.md §2 rule 3
  // warns about, and it has caused a real incident in this project before.
  if (rows === null)
    return (
      <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
        <p className="text-sm font-bold text-amber-900">
          The people tables are not there yet
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
          Run <code>0020_people.sql</code> in the Supabase SQL editor and this
          list will fill itself in. Migrations in this project are applied by
          hand — writing the file does not run it.
        </p>
      </div>
    );

  if (rows.length === 0)
    return (
      <EmptyState
        icon="hammer"
        title="Nobody in the register yet"
        description="Add the trades working on the job, with their rates and their insurance dates. Nothing on the money side creates a person — labour is logged against a name, not a supplier — so they start here."
        action={
          <button type="button" onClick={onAdd} className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add someone
          </button>
        }
      />
    );

  const chip = (row: ContactListRow) => (
    <Badge
      label={
        row.worst_state === "expired"
          ? `${row.expired_count} expired`
          : row.worst_state === "expiring_soon"
            ? `${row.expiring_count} expiring`
            : row.worst_state === "unknown"
              ? "No certificates"
              : "Certificates valid"
      }
      tone={expiryTone(row.worst_state)}
    />
  );

  const columns: PivotColumn<ContactListRow>[] = [
    {
      key: "name",
      header: "Name",
      cell: (row) => (
        <Link
          href={`/contacts/${row.contact.id}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {row.contact.name}
        </Link>
      ),
    },
    {
      key: "trades",
      header: "Trades",
      cell: (row) => row.contact.trades.join(", ") || "—",
    },
    { key: "company", header: "Company", cell: (row) => row.contact.company || "—" },
    { key: "phone", header: "Phone", cell: (row) => row.contact.phone || "—" },
    {
      key: "rate",
      header: "Day rate",
      align: "right",
      cell: (row) =>
        row.contact.day_rate === null
          ? "—"
          : formatCurrency(Number(row.contact.day_rate)),
    },
    { key: "tasks", header: "Tasks", align: "right", cell: (row) => row.task_count },
    { key: "certs", header: "Certificates", cell: chip },
  ];

  return (
    <PivotTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.contact.id}
      card={(row) => (
        <Link
          href={`/contacts/${row.contact.id}`}
          className="card block transition active:scale-[0.99]"
        >
          <div className="flex items-start gap-3">
            <IconTile
              name="hammer"
              tone={
                row.worst_state === "expired"
                  ? "bad"
                  : row.worst_state === "expiring_soon"
                    ? "warn"
                    : "brand"
              }
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
                {row.contact.name}
                {row.contact.status === "inactive" ? (
                  <span className="ml-1.5 text-xs font-medium text-gray-400">
                    inactive
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-gray-500">
                {row.contact.trades.join(", ") || row.contact.company || "No trade set"}
                {row.contact.phone ? ` · ${row.contact.phone}` : ""}
              </span>
            </div>
            <Icon
              name="chevronRight"
              size={18}
              className="mt-1.5 shrink-0 text-gray-300"
            />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-gray-200/70 pt-2.5">
            <span className="text-xs text-gray-500">
              {row.task_count} {row.task_count === 1 ? "task" : "tasks"}
              {row.contact.day_rate !== null
                ? ` · ${formatCurrency(Number(row.contact.day_rate))}/day`
                : ""}
            </span>
            <span className="shrink-0">{chip(row)}</span>
          </div>
        </Link>
      )}
    />
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
