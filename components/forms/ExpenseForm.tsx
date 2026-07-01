"use client";

import { useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateExpense, hasErrors } from "@/lib/validation";
import { calcMaterialsCost, calcTotal, formatCurrency } from "@/lib/calculations";
import { priceKey } from "@/lib/summary";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/States";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  VAT_RATES,
  type ExpenseEntry,
  type TradeLookup,
} from "@/types";

interface Props {
  projectId: string;
  trades: TradeLookup[];
  nextWeek: number;
  expense?: ExpenseEntry;
  // Existing entries for this project — powers the "have I paid more?" warning.
  priorEntries?: ExpenseEntry[];
  onSaved: () => void;
  onCancel: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

export default function ExpenseForm({
  projectId,
  trades,
  nextWeek,
  expense,
  priorEntries = [],
  onSaved,
  onCancel,
}: Props) {
  const toast = useToast();
  const editing = Boolean(expense);

  const [form, setForm] = useState({
    week_number: expense?.week_number?.toString() ?? String(nextWeek),
    description: expense?.description ?? "",
    category: expense?.category ?? "Materials",
    trade: expense?.trade ?? "",
    location_room: expense?.location_room ?? "",
    notes: expense?.notes ?? "",
    supplier: expense?.supplier ?? "",
    invoice_ref: expense?.invoice_ref ?? "",
    paid_date: expense?.paid_date ?? "",
    payment_method: expense?.payment_method ?? "",
    quoted_amount: expense?.quoted_amount?.toString() ?? "",
    actual_amount: expense?.actual_amount?.toString() ?? "",
    paid_amount: expense?.paid_amount?.toString() ?? "",
    qty: expense?.qty?.toString() ?? "",
    unit_cost: expense?.unit_cost?.toString() ?? "",
    vat_rate: expense?.vat_rate?.toString() ?? "0",
    status: expense?.status ?? "Planned",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(
    expense?.receipt_url ?? null
  );

  const isMaterials = form.category === "Materials";

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Last time the same material was bought (by description), excluding this entry.
  const lastPurchase = useMemo(() => {
    if (!isMaterials) return null;
    const key = priceKey(form.description);
    if (!key) return null;
    const matches = priorEntries
      .filter(
        (e) =>
          e.id !== expense?.id &&
          e.category === "Materials" &&
          Number(e.unit_cost) > 0 &&
          priceKey(e.description) === key
      )
      .sort(
        (a, b) =>
          new Date(b.paid_date || b.created_at).getTime() -
          new Date(a.paid_date || a.created_at).getTime()
      );
    return matches[0] ?? null;
  }, [isMaterials, form.description, priorEntries, expense?.id]);

  // Live price comparison vs the last purchase of this item.
  const priceWarning = useMemo(() => {
    const current = Number(form.unit_cost || 0);
    if (!lastPurchase || current <= 0) return null;
    const prev = Number(lastPurchase.unit_cost);
    if (prev <= 0) return null;
    const deltaPct = ((current - prev) / prev) * 100;
    return { prev, deltaPct, date: lastPurchase.paid_date };
  }, [lastPurchase, form.unit_cost]);

  // Selecting a trade pre-fills the supplier name if it's empty.
  function onTradeChange(name: string) {
    setForm((f) => ({ ...f, trade: name }));
  }

  // Auto-fill the Actual amount from Qty × Unit Cost.
  function fillActualFromUnit() {
    const v = calcMaterialsCost(Number(form.qty || 0), Number(form.unit_cost || 0));
    if (v > 0) set("actual_amount", String(v));
  }

  // Live totals for the summary box.
  const calc = useMemo(() => {
    const { subtotal, vatAmount, totalInclVat } = calcTotal(
      Number(form.actual_amount || 0),
      Number(form.vat_rate || 0)
    );
    return {
      subtotal,
      vatAmount,
      totalInclVat,
      remaining: Number(form.actual_amount || 0) - Number(form.paid_amount || 0),
    };
  }, [form.actual_amount, form.vat_rate, form.paid_amount]);

  // Suggest "Paid" once the paid amount covers the actual cost.
  function onPaidChange(value: string) {
    setForm((f) => {
      const next = { ...f, paid_amount: value };
      const actual = Number(f.actual_amount || 0);
      const paid = Number(value || 0);
      if (
        actual > 0 &&
        paid >= actual &&
        (f.status === "Planned" || f.status === "In Progress")
      ) {
        next.status = "Paid";
        if (!next.paid_date) next.paid_date = new Date().toISOString().slice(0, 10);
      }
      return next;
    });
  }

  async function uploadReceipt(expenseId: string) {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch<{ receipt_url: string }>(
      `/api/expenses/${expenseId}/receipt`,
      { method: "POST", body: fd }
    );
    setReceiptUrl(res.receipt_url);
    setFile(null);
  }

  async function removeReceipt() {
    if (!expense) return;
    await apiFetch(`/api/expenses/${expense.id}/receipt`, { method: "DELETE" });
    setReceiptUrl(null);
    toast("Receipt removed", "success");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateExpense(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      const saved = await apiFetch<ExpenseEntry>(
        editing
          ? `/api/projects/${projectId}/expenses/${expense!.id}`
          : `/api/projects/${projectId}/expenses`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      if (file) {
        try {
          await uploadReceipt(saved.id);
        } catch {
          toast("Saved, but receipt upload failed", "error");
        }
      }
      toast(editing ? "Expense updated" : "Expense added", "success");
      onSaved();
    } catch (err) {
      // Do not clear the form on failure — allow retry.
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="week_number">
            Week Number *
          </label>
          <input
            id="week_number"
            type="number"
            min={1}
            className="input"
            value={form.week_number}
            onChange={(e) => set("week_number", e.target.value)}
          />
          {errors.week_number && <p className="field-error">{errors.week_number}</p>}
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category *
          </label>
          <select
            id="category"
            className="input"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="description">
          Description *
        </label>
        <input
          id="description"
          className="input"
          maxLength={200}
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={isMaterials ? "e.g. Bricks, Tiles, Plaster" : "e.g. Owen Brickwork"}
        />
        {errors.description && <p className="field-error">{errors.description}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="trade">
            Trade
          </label>
          <select
            id="trade"
            className="input"
            value={form.trade}
            onChange={(e) => onTradeChange(e.target.value)}
          >
            <option value="">— None —</option>
            {trades.map((t) => (
              <option key={t.id} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="supplier">
            Supplier / Name
          </label>
          <input
            id="supplier"
            className="input"
            value={form.supplier}
            onChange={(e) => set("supplier", e.target.value)}
            placeholder="e.g. Lawsons, Dave Gardener"
          />
        </div>
      </div>

      {/* Amounts: Quoted / Actual / Paid */}
      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
          Amounts (£)
        </legend>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="quoted_amount">
              Quoted
            </label>
            <input
              id="quoted_amount"
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={form.quoted_amount}
              onChange={(e) => set("quoted_amount", e.target.value)}
            />
            {errors.quoted_amount && (
              <p className="field-error">{errors.quoted_amount}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="actual_amount">
              Actual
            </label>
            <input
              id="actual_amount"
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={form.actual_amount}
              onChange={(e) => set("actual_amount", e.target.value)}
            />
            {errors.actual_amount && (
              <p className="field-error">{errors.actual_amount}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="paid_amount">
              Paid
            </label>
            <input
              id="paid_amount"
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={form.paid_amount}
              onChange={(e) => onPaidChange(e.target.value)}
            />
            {errors.paid_amount && (
              <p className="field-error">{errors.paid_amount}</p>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Quoted = original price. Actual = real cost. Remaining is calculated for
          you.
        </p>
      </fieldset>

      {/* Materials detail — qty/unit cost drives the price tracker */}
      {isMaterials && (
        <fieldset className="rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
            Materials detail (for price tracking)
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="qty">
                Qty
              </label>
              <input
                id="qty"
                type="number"
                min={0}
                step="0.01"
                className="input"
                value={form.qty}
                onChange={(e) => set("qty", e.target.value)}
              />
            </div>
            <div>
              <label className="label" htmlFor="unit_cost">
                Unit Cost (£)
              </label>
              <input
                id="unit_cost"
                type="number"
                min={0}
                step="0.01"
                className="input"
                value={form.unit_cost}
                onChange={(e) => set("unit_cost", e.target.value)}
              />
            </div>
          </div>

          {priceWarning && (
            <div
              className={`mt-2 rounded-md px-3 py-2 text-sm ${
                priceWarning.deltaPct > 0.001
                  ? "bg-red-50 text-red-700"
                  : priceWarning.deltaPct < -0.001
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gray-50 text-gray-600"
              }`}
            >
              Last time &ldquo;{form.description.trim()}&rdquo; was{" "}
              {formatCurrency(priceWarning.prev)}/unit
              {priceWarning.date ? ` on ${priceWarning.date}` : ""} — now{" "}
              {formatCurrency(Number(form.unit_cost))}/unit{" "}
              {priceWarning.deltaPct > 0.001
                ? `▲ +${priceWarning.deltaPct.toFixed(1)}%`
                : priceWarning.deltaPct < -0.001
                  ? `▼ ${priceWarning.deltaPct.toFixed(1)}%`
                  : "(no change)"}
            </div>
          )}

          <button
            type="button"
            className="mt-2 text-xs text-brand hover:underline"
            onClick={fillActualFromUnit}
          >
            Use Qty × Unit Cost as Actual
          </button>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="paid_amount_date">
            Date Paid
          </label>
          <input
            id="paid_amount_date"
            type="date"
            className="input"
            value={form.paid_date ?? ""}
            onChange={(e) => set("paid_date", e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="payment_method">
            Payment Method
          </label>
          <select
            id="payment_method"
            className="input"
            value={form.payment_method}
            onChange={(e) => set("payment_method", e.target.value)}
          >
            <option value="">—</option>
            {PAYMENT_METHODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="vat_rate">
            VAT Rate *
          </label>
          <select
            id="vat_rate"
            className="input"
            value={form.vat_rate}
            onChange={(e) => set("vat_rate", e.target.value)}
          >
            {VAT_RATES.map((r) => (
              <option key={r} value={r}>
                {r}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status *
          </label>
          <select
            id="status"
            className="input"
            value={form.status}
            onChange={(e) => set("status", e.target.value)}
          >
            {EXPENSE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="location_room">
            Location / Room
          </label>
          <input
            id="location_room"
            className="input"
            value={form.location_room}
            onChange={(e) => set("location_room", e.target.value)}
            placeholder="e.g. Kitchen"
          />
        </div>
        <div>
          <label className="label" htmlFor="invoice_ref">
            Invoice / Receipt Ref
          </label>
          <input
            id="invoice_ref"
            className="input"
            value={form.invoice_ref}
            onChange={(e) => set("invoice_ref", e.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className="input"
          rows={2}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      {/* Receipt upload */}
      <div>
        <label className="label">Receipt (image or PDF, max 10MB)</label>
        {receiptUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-gray-200 p-2 text-sm">
            <span className="text-gray-600">📎 Receipt attached</span>
            <button
              type="button"
              onClick={removeReceipt}
              className="text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>
        ) : (
          <input
            type="file"
            accept={ACCEPT}
            aria-label="Receipt file"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        )}
      </div>

      {/* Live totals */}
      <div className="rounded-lg bg-brand-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Subtotal (Actual)</span>
          <span className="font-medium">{formatCurrency(calc.subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">VAT ({form.vat_rate}%)</span>
          <span className="font-medium">{formatCurrency(calc.vatAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">Total incl. VAT</span>
          <span className="font-medium">{formatCurrency(calc.totalInclVat)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-brand-100 pt-1 text-base font-bold text-brand">
          <span>Remaining to pay</span>
          <span>{formatCurrency(calc.remaining)}</span>
        </div>
      </div>

      <div className="flex gap-2 pb-2">
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving && <Spinner />}
          {editing ? "Save changes" : "Add expense"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
