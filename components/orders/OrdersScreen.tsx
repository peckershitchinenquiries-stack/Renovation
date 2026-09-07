"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { overdueOrders, overDeliveredLines } from "@/lib/purchaseOrders";
import { todayISO } from "@/lib/certifications";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, Spinner } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChipRow } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import PurchaseOrderForm from "@/components/forms/PurchaseOrderForm";
import type { PurchaseOrderList } from "@/lib/data";
import {
  PO_STATUS_LABELS,
  type Project,
  type PoStatus,
  type PurchaseOrderView,
} from "@/types";

const STATUS_TONE: Record<PoStatus, "neutral" | "info" | "warn" | "good" | "bad"> =
  {
    draft: "neutral",
    sent: "info",
    part_received: "warn",
    received: "good",
    cancelled: "bad",
  };

/**
 * Purchase orders (migration 0023).
 *
 * The two figures worth the whole screen are at the top of each card:
 * **overdue** — sent, promised for a date that has passed, still not here —
 * and **price variance**, what the invoices actually came to against what the
 * order said. Everything else is filing.
 */
export default function OrdersScreen({
  list,
  project,
}: {
  // Null means migration 0023 has not been run.
  list: PurchaseOrderList | null;
  project: Project;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<string>("live");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrderView | null>(null);
  const [receiving, setReceiving] = useState<PurchaseOrderView | null>(null);
  const [deleting, setDeleting] = useState<PurchaseOrderView | null>(null);

  // Memoised for the same reason as `documents` in DocumentsScreen: `?? []`
  // is a new array every render, and three useMemo hooks below depend on it.
  const orders = useMemo(() => list?.orders ?? [], [list]);
  const today = todayISO();
  const overdue = useMemo(() => overdueOrders(orders, today), [orders, today]);
  const overDelivered = useMemo(() => overDeliveredLines(orders), [orders]);

  const visible = useMemo(() => {
    if (filter === "all") return orders;
    if (filter === "overdue") return overdue;
    // "Live" is the useful default: what is out there and has not landed.
    if (filter === "live")
      return orders.filter(
        (o) => o.status === "sent" || o.status === "part_received"
      );
    return orders.filter((o) => o.status === filter);
  }, [orders, filter, overdue]);

  async function remove(order: PurchaseOrderView) {
    try {
      await apiFetch(`/api/projects/${project.id}/orders/${order.id}`, {
        method: "DELETE",
      });
      toast("Order deleted", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    } finally {
      setDeleting(null);
    }
  }

  if (!list)
    return (
      <div>
        <PageHeader
          title="Orders"
          subtitle={project.name}
          backHref={`/projects/${project.id}`}
          backLabel="Back to project"
        />
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="text-sm font-bold text-amber-900">
            The purchase order tables are not there yet
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
            Run <code>0023_purchase_orders.sql</code> in the Supabase SQL
            editor. Migrations in this project are applied by hand — writing the
            file does not run it.
          </p>
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={`${orders.length} raised · ${project.name}`}
        backHref={`/projects/${project.id}`}
        backLabel="Back to project"
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={16} />
            Raise
          </button>
        }
      />

      <div className="space-y-3">
        {overdue.length > 0 ? (
          <button
            type="button"
            onClick={() => setFilter("overdue")}
            className="flex w-full items-center gap-3 rounded-2xl bg-amber-50 p-4 text-left ring-1 ring-inset ring-amber-600/20"
          >
            <Icon name="truck" size={19} className="shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1 text-sm font-bold text-amber-900">
              {overdue.length} {overdue.length === 1 ? "order is" : "orders are"}{" "}
              past the promised delivery date
            </span>
            <Icon
              name="chevronRight"
              size={18}
              className="shrink-0 text-amber-400"
            />
          </button>
        ) : null}

        {overDelivered.length > 0 ? (
          <div className="rounded-2xl bg-blue-50 p-4 text-[0.8125rem] leading-relaxed text-blue-900 ring-1 ring-inset ring-blue-600/15">
            <p className="font-bold">
              {overDelivered.length}{" "}
              {overDelivered.length === 1 ? "line has" : "lines have"} taken more
              than was ordered
            </p>
            <ul className="mt-1 space-y-0.5">
              {overDelivered.slice(0, 4).map(({ order, line }) => (
                <li key={line.id}>
                  {order.po_number ?? "Order"} · {line.description}: ordered{" "}
                  {line.qty_ordered}, received {line.qty_received}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {orders.length > 0 ? (
          <ChipRow
            label="Filter orders"
            value={filter}
            onChange={setFilter}
            options={[
              {
                value: "live",
                label: "Out there",
                count: orders.filter(
                  (o) => o.status === "sent" || o.status === "part_received"
                ).length,
              },
              { value: "overdue", label: "Overdue", count: overdue.length },
              {
                value: "draft",
                label: "Draft",
                count: orders.filter((o) => o.status === "draft").length,
              },
              {
                value: "received",
                label: "Received",
                count: orders.filter((o) => o.status === "received").length,
              },
              { value: "all", label: "All", count: orders.length },
            ]}
          />
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon="truck"
            title={orders.length === 0 ? "No orders raised" : "Nothing to show"}
            description={
              orders.length === 0
                ? "The app has always recorded invoices you were sent. This records the orders you send out — so when the invoice arrives you can see whether it matches what you asked for."
                : "No orders match this filter."
            }
            action={
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="btn btn-primary"
              >
                <Icon name="plus" size={16} />
                Raise an order
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {visible.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                today={today}
                onEdit={() => setEditing(order)}
                onReceive={() => setReceiving(order)}
                onDelete={() => setDeleting(order)}
              />
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        title={editing ? "Edit order" : "Raise an order"}
        size="lg"
      >
        <PurchaseOrderForm
          projectId={project.id}
          order={editing ?? undefined}
          suppliers={list.suppliers}
          tasks={list.tasks}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      </Sheet>

      <ReceiptSheet
        order={receiving}
        projectId={project.id}
        onClose={() => setReceiving(null)}
        onSaved={() => {
          setReceiving(null);
          router.refresh();
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this order?"
        message="Its lines go with it. Any invoice matched to it survives and simply becomes unmatched — deleting a document you sent never deletes a bill you received."
        confirmLabel="Delete"
        danger
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function OrderCard({
  order,
  today,
  onEdit,
  onReceive,
  onDelete,
}: {
  order: PurchaseOrderView;
  today: string;
  onEdit: () => void;
  onReceive: () => void;
  onDelete: () => void;
}) {
  const late =
    (order.status === "sent" || order.status === "part_received") &&
    order.expected_delivery !== null &&
    order.expected_delivery < today;

  return (
    <div className="card p-0">
      <button
        type="button"
        onClick={onEdit}
        className="flex w-full items-start gap-3 px-4 pb-3 pt-3.5 text-left"
      >
        <IconTile
          name="truck"
          tone={late ? "warn" : order.status === "received" ? "good" : "brand"}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-bold text-gray-900">
            {order.po_number ?? "No PO number"}
            {order.supplier_name ? (
              <span className="font-medium text-gray-500">
                {" "}
                · {order.supplier_name}
              </span>
            ) : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-gray-500">
            {order.line_count} {order.line_count === 1 ? "line" : "lines"} ·
            raised {formatDisplayDate(order.raised_on)}
            {order.expected_delivery
              ? ` · due ${formatDisplayDate(order.expected_delivery)}`
              : ""}
            {order.task_name ? ` · ${order.task_name}` : ""}
          </p>
        </div>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            label={PO_STATUS_LABELS[order.status]}
            tone={STATUS_TONE[order.status]}
          />
          {late ? <Badge label="Overdue" tone="warn" /> : null}
        </span>
      </button>

      <div className="grid grid-cols-3 border-t border-gray-200/70">
        <div className="px-3 py-2.5">
          <p className="text-2xs font-medium text-gray-400">Ordered, ex VAT</p>
          <p className="tnum mt-0.5 truncate text-[0.8125rem] font-bold text-gray-900">
            {formatCurrency(order.net)}
          </p>
        </div>
        <div className="border-l border-gray-200/70 px-3 py-2.5">
          <p className="text-2xs font-medium text-gray-400">Invoiced, ex VAT</p>
          <p className="tnum mt-0.5 truncate text-[0.8125rem] font-bold text-gray-900">
            {order.invoice_count === 0 ? "—" : formatCurrency(order.invoiced_net)}
          </p>
        </div>
        <div className="border-l border-gray-200/70 px-3 py-2.5">
          <p className="text-2xs font-medium text-gray-400">Difference</p>
          {/* Null, not zero, until something has been invoiced. £0 would read
              as "came in exactly on budget", which is a very different and much
              more reassuring claim than "nothing has arrived". */}
          <p
            className={`tnum mt-0.5 truncate text-[0.8125rem] font-bold ${
              order.price_variance === null
                ? "text-gray-400"
                : order.price_variance > 0.01
                  ? "text-red-600"
                  : order.price_variance < -0.01
                    ? "text-emerald-600"
                    : "text-gray-900"
            }`}
          >
            {order.price_variance === null
              ? "not invoiced"
              : `${order.price_variance > 0 ? "+" : ""}${formatCurrency(
                  order.price_variance
                )}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 border-t border-gray-200/70 px-2 py-1.5">
        {order.status !== "draft" && order.status !== "cancelled" ? (
          <button
            type="button"
            onClick={onReceive}
            className="btn btn-ghost btn-sm"
          >
            <Icon name="package" size={15} />
            Record delivery
          </button>
        ) : null}
        <button type="button" onClick={onEdit} className="btn btn-ghost btn-sm">
          <Icon name="edit" size={15} />
          Edit
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Delete order"
          onClick={onDelete}
          className="btn-icon text-gray-300 hover:text-red-600"
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  );
}

/**
 * Record what turned up.
 *
 * One number per line and nothing else editable. The order's status follows
 * the quantities rather than being picked — an order whose lines have all
 * arrived IS received, and letting the two disagree makes the status
 * worthless.
 */
function ReceiptSheet({
  order,
  projectId,
  onClose,
  onSaved,
}: {
  order: PurchaseOrderView | null;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Keyed by the order so reopening a different one does not inherit the last
  // one's numbers.
  const key = order?.id ?? "";
  const [loadedFor, setLoadedFor] = useState("");
  if (order && loadedFor !== key) {
    setLoadedFor(key);
    setValues(
      Object.fromEntries(
        order.lines.map((l) => [l.id, String(l.qty_received || "")])
      )
    );
  }

  async function save() {
    if (!order) return;
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/orders/${order.id}/receipt`, {
        method: "POST",
        body: JSON.stringify({
          lines: order.lines.map((l) => ({
            line_id: l.id,
            qty_received: Number(values[l.id] ?? 0) || 0,
          })),
        }),
      });
      toast("Delivery recorded", "success");
      onSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={order !== null}
      onClose={onClose}
      title="Record a delivery"
      description={
        order
          ? `${order.po_number ?? "Order"}${
              order.supplier_name ? ` · ${order.supplier_name}` : ""
            }`
          : undefined
      }
      size="md"
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="btn-primary flex-1"
          >
            {saving ? <Spinner /> : null}
            Save
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {(order?.lines ?? []).map((line) => (
          <div key={line.id} className="card-sunken p-3">
            <p className="text-[0.8125rem] font-semibold text-gray-900">
              {line.description}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              Ordered {line.qty_ordered}
              {line.unit ? ` ${line.unit}` : ""}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <label className="label mb-0 text-2xs" htmlFor={`recv-${line.id}`}>
                Received
              </label>
              <input
                id={`recv-${line.id}`}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                className="input flex-1"
                value={values[line.id] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [line.id]: e.target.value }))
                }
              />
            </div>
            {Number(values[line.id] ?? 0) > Number(line.qty_ordered) + 0.001 ? (
              <p className="mt-1.5 text-xs font-semibold text-blue-700">
                More than was ordered. That is recorded, not refused — it is the
                thing this table exists to make visible.
              </p>
            ) : null}
          </div>
        ))}
      </div>
      <p className="hint mt-3">
        The order&apos;s status follows these numbers: everything delivered
        makes it <strong>Received</strong>, some of it makes it{" "}
        <strong>Part received</strong>.
      </p>
    </Sheet>
  );
}
