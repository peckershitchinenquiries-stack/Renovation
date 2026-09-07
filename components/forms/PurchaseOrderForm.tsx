"use client";

import { useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validatePurchaseOrder, hasErrors, todayISO } from "@/lib/validation";
import { orderLineTotals } from "@/lib/purchaseOrders";
import { formatCurrency } from "@/lib/calculations";
import { round2 } from "@/lib/purchases";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import {
  PO_STATUSES,
  PO_STATUS_LABELS,
  VAT_RATES,
  type PurchaseOrderLineInput,
  type PurchaseOrderView,
} from "@/types";

/**
 * Raise or edit a purchase order (migration 0023).
 *
 * The running total under the lines is computed the same way
 * `lib/purchaseOrders.ts` computes it on read, from the same rounding — so
 * what the form shows and what the order is worth cannot disagree. There is no
 * total column on the table and nothing here writes one.
 *
 * `qty_received` is deliberately NOT on this form. Recording a delivery has
 * its own route and its own sheet, because it is done standing in a yard on a
 * phone, and making somebody open a form with every price and VAT rate
 * editable to type one number is how a wrong price gets saved by accident.
 */

const blankLine = (): PurchaseOrderLineInput => ({
  description: "",
  qty_ordered: "",
  unit: "",
  unit_price: "",
  vat_rate: 20,
});

export default function PurchaseOrderForm({
  projectId,
  order,
  suppliers = [],
  tasks = [],
  onSaved,
  onCancel,
}: {
  projectId: string;
  order?: PurchaseOrderView;
  suppliers?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(order);
  const [form, setForm] = useState({
    supplier_name: order?.supplier_name ?? "",
    po_number: order?.po_number ?? "",
    raised_on: order?.raised_on ?? todayISO(),
    expected_delivery: order?.expected_delivery ?? "",
    status: order?.status ?? "draft",
    task_id: order?.task_id ?? "",
    notes: order?.notes ?? "",
  });
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>(
    order?.lines.length
      ? order.lines.map((l) => ({
          id: l.id,
          item_id: l.item_id,
          description: l.description,
          qty_ordered: String(l.qty_ordered),
          // Carried through untouched so an edit cannot silently wipe a
          // delivery that was already recorded elsewhere.
          qty_received: String(l.qty_received),
          unit: l.unit ?? "",
          unit_price: String(l.unit_price),
          vat_rate: l.vat_rate,
        }))
      : [blankLine()]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const setLine = (i: number, patch: Partial<PurchaseOrderLineInput>) =>
    setLines((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // Same arithmetic the read path uses, so the figure on screen while typing
  // is the figure the order is worth once saved.
  const totals = useMemo(() => {
    let net = 0;
    let vat = 0;
    for (const line of lines) {
      const totals = orderLineTotals(
        line.qty_ordered,
        line.unit_price,
        line.vat_rate
      );
      net += totals.line_net;
      vat += totals.line_vat;
    }
    return { net: round2(net), vat: round2(vat), gross: round2(net + vat) };
  }, [lines]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = { ...form, lines };
    const v = validatePurchaseOrder(payload);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/projects/${projectId}/orders/${order!.id}`
          : `/api/projects/${projectId}/orders`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }
      );
      toast(editing ? "Order saved" : "Order raised", "success");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="po-supplier">
          Supplier
        </label>
        <input
          id="po-supplier"
          className="input"
          list="po-supplier-options"
          value={form.supplier_name ?? ""}
          onChange={(e) => set("supplier_name", e.target.value)}
          placeholder="Lawsons"
        />
        <datalist id="po-supplier-options">
          {suppliers.map((s) => (
            <option key={s.id} value={s.name} />
          ))}
        </datalist>
        <p className="hint">
          Typing a merchant that is not on file creates it — the same one the
          invoice will match against later, rather than a near-duplicate.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="po-number">
            PO number
          </label>
          <input
            id="po-number"
            className={`input ${errors.po_number ? "input-invalid" : ""}`}
            value={form.po_number ?? ""}
            onChange={(e) => set("po_number", e.target.value)}
            placeholder="PO-024"
          />
          {errors.po_number && <p className="field-error">{errors.po_number}</p>}
        </div>
        <div>
          <label className="label" htmlFor="po-status">
            Status
          </label>
          <Select
            id="po-status"
            title="Status"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={PO_STATUSES.map((s) => ({
              value: s,
              label: PO_STATUS_LABELS[s],
            }))}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="po-raised">
            Raised
          </label>
          <DatePicker
            id="po-raised"
            title="Raised on"
            clearable={false}
            value={form.raised_on}
            onChange={(v) => set("raised_on", v)}
          />
        </div>
        <div>
          <label className="label" htmlFor="po-expected">
            Expected delivery
          </label>
          <DatePicker
            id="po-expected"
            title="Expected delivery"
            placeholder="Not promised"
            value={form.expected_delivery ?? ""}
            onChange={(v) => set("expected_delivery", v)}
          />
          <p className="hint">
            The list flags anything sent and past this date. It is how joinery
            and windows slip without anyone noticing.
          </p>
        </div>
      </div>

      {tasks.length > 0 ? (
        <div>
          <label className="label" htmlFor="po-task">
            For which task
          </label>
          <Select
            id="po-task"
            title="Task"
            placeholder="Not tied to a task"
            clearable
            value={form.task_id ?? ""}
            onChange={(v) => set("task_id", v)}
            options={tasks.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      ) : null}

      {/* ---- lines ---- */}
      <div>
        <div className="mb-2 flex items-end justify-between">
          <span className="label mb-0">What is being ordered</span>
          <button
            type="button"
            onClick={() => setLines((rows) => [...rows, blankLine()])}
            className="btn btn-ghost btn-sm"
          >
            <Icon name="plus" size={15} />
            Add line
          </button>
        </div>
        {errors.lines && <p className="field-error mb-2">{errors.lines}</p>}

        <div className="space-y-2.5">
          {lines.map((line, i) => (
            <div key={i} className="card-sunken space-y-2.5 p-3">
              <div className="flex items-start gap-2">
                <input
                  className={`input flex-1 ${
                    errors[`lines.${i}.description`] ? "input-invalid" : ""
                  }`}
                  value={line.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                  placeholder="25kg bags of multi-finish"
                  aria-label={`Line ${i + 1} description`}
                />
                {lines.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove line ${i + 1}`}
                    onClick={() =>
                      setLines((rows) => rows.filter((_, j) => j !== i))
                    }
                    className="btn-icon text-gray-400 hover:text-red-600"
                  >
                    <Icon name="trash" size={17} />
                  </button>
                ) : null}
              </div>
              {errors[`lines.${i}.description`] && (
                <p className="field-error">{errors[`lines.${i}.description`]}</p>
              )}

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className="label text-2xs">Qty</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    min="0"
                    className="input"
                    value={line.qty_ordered}
                    onChange={(e) => setLine(i, { qty_ordered: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label text-2xs">Unit</label>
                  <input
                    className="input"
                    value={line.unit ?? ""}
                    onChange={(e) => setLine(i, { unit: e.target.value })}
                    placeholder="bag"
                  />
                </div>
                <div>
                  <label className="label text-2xs">Unit price</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    min="0"
                    className="input"
                    value={line.unit_price}
                    onChange={(e) => setLine(i, { unit_price: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label text-2xs">VAT</label>
                  <Select
                    title="VAT rate"
                    value={String(line.vat_rate)}
                    onChange={(v) => setLine(i, { vat_rate: v })}
                    options={VAT_RATES.map((r) => ({
                      value: String(r),
                      label: `${r}%`,
                    }))}
                    invalid={Boolean(errors[`lines.${i}.vat_rate`])}
                  />
                </div>
              </div>
              {errors[`lines.${i}.vat_rate`] && (
                <p className="field-error">{errors[`lines.${i}.vat_rate`]}</p>
              )}

              <p className="tnum text-right text-xs text-gray-500">
                {formatCurrency(
                  round2(
                    (Number(line.qty_ordered) || 0) *
                      (Number(line.unit_price) || 0)
                  )
                )}{" "}
                ex VAT
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between rounded-2xl bg-gray-50 px-4 py-3">
          <span className="text-[0.8125rem] text-gray-500">
            Ordered · {formatCurrency(totals.net)} ex VAT + {formatCurrency(totals.vat)} VAT
          </span>
          <span className="tnum text-lg font-bold text-gray-900">
            {formatCurrency(totals.gross)}
          </span>
        </div>
        <p className="hint">
          Not spend. Nothing on this form reaches Committed, Cost, Paid or
          Owed — only the invoice that follows is money.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="po-notes">
          Notes
        </label>
        <textarea
          id="po-notes"
          className="textarea"
          rows={2}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save order" : "Raise order"}
        </button>
      </div>
    </form>
  );
}
