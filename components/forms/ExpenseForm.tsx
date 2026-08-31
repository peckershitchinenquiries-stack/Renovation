"use client";

import { useId, useMemo, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateExpense, hasErrors } from "@/lib/validation";
import { calcMaterialsCost, calcTotal, formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
import { priceKey } from "@/lib/summary";
import { buildMaterialPriceIndex, comparePrice } from "@/lib/purchases";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { PriceMoveBadge } from "@/components/purchases/PriceMoveBadge";
import TradeSelect from "@/components/forms/TradeSelect";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  VAT_RATES,
  type ExpenseEntry,
  type InvoiceLineView,
  type TradeLookup,
} from "@/types";

interface Props {
  projectId: string;
  trades: TradeLookup[];
  nextWeek: number;
  expense?: ExpenseEntry;
  // Prefills a *new* entry from a previous one ("Repeat"). Ignored when editing.
  template?: ExpenseEntry;
  // Existing entries for this project — powers the description/supplier
  // suggestions and the duplicate check.
  priorEntries?: ExpenseEntry[];
  // This project's invoice lines — combined with priorEntries to power the
  // "have I paid more?" warning and the last-price hint (buildMaterialPriceIndex).
  // Required, not optional: the whole point of the fix this prop exists for was
  // that a missed render path silently disabled the warning, so a caller that
  // forgets it fails to compile instead.
  invoiceLines: InvoiceLineView[];
  onSaved: () => void;
  onCancel: () => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

// Distinct, trimmed, case-insensitively de-duplicated values for a datalist.
function suggestions(values: (string | null | undefined)[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const text = value?.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, text);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

export default function ExpenseForm({
  projectId,
  trades,
  nextWeek,
  expense,
  template,
  priorEntries = [],
  invoiceLines,
  onSaved,
  onCancel,
}: Props) {
  const toast = useToast();
  const editing = Boolean(expense);
  const uid = useId();

  // Editing loads the entry as-is. "Repeat" copies the descriptive fields of a
  // past entry but starts a fresh, unpaid one in the current week — so the only
  // thing you normally have to change is the price.
  const [form, setForm] = useState(() => {
    const base = expense ?? template;
    return {
      week_number: expense?.week_number?.toString() ?? String(nextWeek),
      description: base?.description ?? "",
      category: base?.category ?? "Materials",
      trade: base?.trade ?? "",
      location_room: base?.location_room ?? "",
      notes: base?.notes ?? "",
      supplier: base?.supplier ?? "",
      invoice_ref: expense?.invoice_ref ?? "",
      paid_date: expense?.paid_date ?? "",
      payment_method: expense?.payment_method ?? "",
      quoted_amount: base?.quoted_amount?.toString() ?? "",
      actual_amount: base?.actual_amount?.toString() ?? "",
      paid_amount: expense?.paid_amount?.toString() ?? "",
      qty: base?.qty?.toString() ?? "",
      unit_cost: base?.unit_cost?.toString() ?? "",
      vat_rate: base?.vat_rate?.toString() ?? "0",
      status: expense?.status ?? "Planned",
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  // Local copy so a trade added inline (TradeSelect's "+ Add new trade")
  // shows up in this form's own dropdown immediately, without a round trip.
  const [tradeList, setTradeList] = useState<TradeLookup[]>(trades);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(
    expense?.receipt_url ?? null
  );

  // Optional fields stay collapsed so a quick on-site entry is short. They open
  // automatically when editing an entry that already uses any of them.
  const [showMore, setShowMore] = useState(
    Boolean(
      expense &&
        (expense.paid_date ||
          expense.payment_method ||
          expense.location_room ||
          expense.invoice_ref ||
          expense.notes ||
          expense.receipt_url)
    )
  );

  const isMaterials = form.category === "Materials";

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Type-ahead suggestions drawn from what has already been entered — this also
  // keeps spellings consistent, which is what the price tracker groups on.
  const descriptionOptions = useMemo(
    () => suggestions(priorEntries.map((e) => e.description)),
    [priorEntries]
  );
  const supplierOptions = useMemo(
    () => suggestions(priorEntries.map((e) => e.supplier)),
    [priorEntries]
  );

  // Every material this project has been charged for before, hand-entered or
  // invoiced, keyed by normalised description — see buildMaterialPriceIndex.
  const materialPriceIndex = useMemo(
    () => buildMaterialPriceIndex(priorEntries, invoiceLines, expense?.id),
    [priorEntries, invoiceLines, expense?.id]
  );

  // Last time the same material was bought (by description).
  const lastPurchase = useMemo(() => {
    if (!isMaterials) return null;
    const key = priceKey(form.description);
    if (!key) return null;
    return materialPriceIndex.get(key) ?? null;
  }, [isMaterials, form.description, materialPriceIndex]);

  // Live price comparison vs the last purchase of this item. The typed unit
  // cost carries no unit of its own (expense_entries has no unit column), so
  // it is compared as unit: null — comparePrice's own rule means that only
  // matches a prior observation that is *also* unit-less, and correctly
  // suppresses the percentage against a priced invoice line with a known unit.
  const priceWarning = useMemo(() => {
    const current = Number(form.unit_cost || 0);
    if (!lastPurchase || current <= 0) return null;
    const { delta_pct, move } = comparePrice(
      { unit_price: current, unit: null },
      { unit_price: lastPurchase.unit_price, unit: lastPurchase.unit }
    );
    return { ...lastPurchase, deltaPct: delta_pct, move };
  }, [lastPurchase, form.unit_cost]);

  // Shown before a unit cost is typed, so the last price is visible while you
  // are still deciding what to enter.
  const lastPriceHint = useMemo(() => {
    if (!lastPurchase || Number(form.unit_cost || 0) > 0) return null;
    return lastPurchase;
  }, [lastPurchase, form.unit_cost]);

  // Same item, same week, same amount — almost certainly logged twice.
  const duplicateWarning = useMemo(() => {
    const key = priceKey(form.description);
    const week = Number(form.week_number || 0);
    const actual = Number(form.actual_amount || 0);
    if (!key || !week || actual <= 0) return null;
    const match = priorEntries.find(
      (e) =>
        e.id !== expense?.id &&
        e.status !== "Cancelled" &&
        e.week_number === week &&
        priceKey(e.description) === key &&
        Math.abs(Number(e.actual_amount) - actual) < 0.005
    );
    return match ?? null;
  }, [
    form.description,
    form.week_number,
    form.actual_amount,
    priorEntries,
    expense?.id,
  ]);

  // Paying more than the entry is worth is usually a typo or a wrong field.
  // Compared against the incl-VAT total, since that is what actually gets paid.
  const overpaidWarning = useMemo(() => {
    const { totalInclVat } = calcTotal(
      Number(form.actual_amount || 0),
      Number(form.vat_rate || 0)
    );
    const paid = Number(form.paid_amount || 0);
    if (totalInclVat <= 0 || paid <= 0) return null;
    if (paid - totalInclVat < 0.005) return null;
    return { actual: totalInclVat, paid, excess: paid - totalInclVat };
  }, [form.actual_amount, form.vat_rate, form.paid_amount]);

  // Qty × Unit Cost should normally equal the Actual amount; a mismatch means
  // one of the three numbers was mistyped.
  const unitMismatch = useMemo(() => {
    if (!isMaterials) return null;
    const qty = Number(form.qty || 0);
    const unit = Number(form.unit_cost || 0);
    const actual = Number(form.actual_amount || 0);
    if (qty <= 0 || unit <= 0 || actual <= 0) return null;
    const expected = calcMaterialsCost(qty, unit);
    if (Math.abs(expected - actual) < 0.01) return null;
    return { expected, actual };
  }, [isMaterials, form.qty, form.unit_cost, form.actual_amount]);

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
      remaining: totalInclVat - Number(form.paid_amount || 0),
    };
  }, [form.actual_amount, form.vat_rate, form.paid_amount]);

  // Suggest "Paid" once the paid amount covers the incl-VAT cost.
  function onPaidChange(value: string) {
    setForm((f) => {
      const next = { ...f, paid_amount: value };
      const { totalInclVat: due } = calcTotal(
        Number(f.actual_amount || 0),
        Number(f.vat_rate || 0)
      );
      const paid = Number(value || 0);
      if (
        due > 0 &&
        paid >= due - 0.005 &&
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
      <datalist id={`${uid}-descriptions`}>
        {descriptionOptions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
      <datalist id={`${uid}-suppliers`}>
        {supplierOptions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="week_number">
            Week Number *
          </label>
          <input
            id="week_number"
            type="number"
            inputMode="numeric"
            min={1}
            className="input"
            value={form.week_number}
            onChange={(e) => set("week_number", e.target.value)}
          />
          {errors.week_number && <p className="field-error">{errors.week_number}</p>}
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category <span className="text-red-500">*</span>
          </label>
          <Select
            id="category"
            title="Category"
            value={form.category}
            onChange={(v) => set("category", v)}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
          />
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
          list={`${uid}-descriptions`}
          autoComplete="off"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          placeholder={isMaterials ? "e.g. Bricks, Tiles, Plaster" : "e.g. Owen Brickwork"}
        />
        {errors.description && <p className="field-error">{errors.description}</p>}
        {duplicateWarning && (
          <p className="field-warning">
            Possible duplicate — week {duplicateWarning.week_number} already has
            &ldquo;{duplicateWarning.description}&rdquo; at{" "}
            {formatCurrency(Number(duplicateWarning.actual_amount))}. Save anyway
            if this is a second purchase.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="trade">
            Trade
          </label>
          <TradeSelect
            id="trade"
            value={form.trade}
            trades={tradeList}
            onChange={onTradeChange}
            onTradeAdded={(t) => setTradeList((list) => [...list, t])}
          />
        </div>
        <div>
          <label className="label" htmlFor="supplier">
            Supplier / Name
          </label>
          <input
            id="supplier"
            className="input"
            list={`${uid}-suppliers`}
            autoComplete="off"
            value={form.supplier}
            onChange={(e) => set("supplier", e.target.value)}
            placeholder="e.g. Lawsons, Dave Gardener"
          />
        </div>
      </div>

      {/* Amounts, in the app's four words: Committed / Cost / Paid. The
          field ids keep the column names (quoted_amount, actual_amount) —
          only what the reader is told has changed. */}
      <fieldset className="card-sunken">
        <legend className="eyebrow mb-2.5">Amounts</legend>
        {/* Stacked on a phone. Three money fields sharing one 343px row leaves
            each about 100px, which cannot show "£12,450.00" — the figures were
            being cut off in exactly the entries that matter most. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MoneyField
            id="quoted_amount"
            label={MONEY.committed.label}
            value={form.quoted_amount}
            error={errors.quoted_amount}
            onChange={(v) => set("quoted_amount", v)}
          />
          <MoneyField
            id="actual_amount"
            label={MONEY.cost.label}
            value={form.actual_amount}
            error={errors.actual_amount}
            onChange={(v) => set("actual_amount", v)}
          />
          <MoneyField
            id="paid_amount"
            label={MONEY.paid.label}
            value={form.paid_amount}
            error={errors.paid_amount}
            onChange={onPaidChange}
          />
        </div>
        {overpaidWarning ? (
          <p className="field-warning">
            {MONEY.paid.label} ({formatCurrency(overpaidWarning.paid)}) is{" "}
            {formatCurrency(overpaidWarning.excess)} more than{" "}
            {MONEY.cost.label.toLowerCase()} (
            {formatCurrency(overpaidWarning.actual)}). Check the figures unless
            this was an overpayment or deposit.
          </p>
        ) : (
          <p className="hint">
            {MONEY.committed.label} = the price agreed. {MONEY.cost.label} = what
            it came to. {MONEY.owed.label} is worked out for you.
          </p>
        )}
      </fieldset>

      {/* Materials detail — qty/unit cost drives the price tracker */}
      {isMaterials && (
        <fieldset className="card-sunken">
          <legend className="eyebrow mb-2.5">
            Materials detail — drives the price tracker
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="qty">
                Qty
              </label>
              <input
                id="qty"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                placeholder="0"
                className="input tnum"
                value={form.qty}
                onChange={(e) => set("qty", e.target.value)}
              />
            </div>
            <MoneyField
              id="unit_cost"
              label="Unit cost"
              value={form.unit_cost}
              onChange={(v) => set("unit_cost", v)}
            />
          </div>

          {lastPriceHint && (
            <div className="mt-2.5 rounded-xl bg-white px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-gray-600 shadow-card">
              Last time &ldquo;{form.description.trim()}&rdquo; was{" "}
              {formatCurrency(lastPriceHint.unit_price)}
              {lastPriceHint.unit ? ` / ${lastPriceHint.unit}` : "/unit"}
              {lastPriceHint.supplier ? `, ${lastPriceHint.supplier}` : ""}
              {lastPriceHint.date ? `, ${lastPriceHint.date}` : ""}.
            </div>
          )}

          {priceWarning && (
            <div
              className={`mt-2.5 rounded-xl px-3.5 py-2.5 text-[0.8125rem] leading-relaxed ring-1 ring-inset ${
                priceWarning.move === "up"
                  ? "bg-red-50 text-red-700 ring-red-600/15"
                  : priceWarning.move === "down"
                    ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
                    : priceWarning.move === "unit_change"
                      ? "bg-amber-50 text-amber-800 ring-amber-600/15"
                      : "bg-white text-gray-600 shadow-card ring-transparent"
              }`}
            >
              Last time &ldquo;{form.description.trim()}&rdquo; was{" "}
              {formatCurrency(priceWarning.unit_price)}
              {priceWarning.unit ? ` / ${priceWarning.unit}` : "/unit"}
              {priceWarning.supplier ? `, ${priceWarning.supplier}` : ""}
              {priceWarning.date ? `, ${priceWarning.date}` : ""} — now{" "}
              {formatCurrency(Number(form.unit_cost))}/unit{" "}
              <PriceMoveBadge
                move={priceWarning.move}
                deltaPct={priceWarning.deltaPct}
                unit={null}
                previousUnit={priceWarning.unit}
              />
            </div>
          )}

          {unitMismatch && (
            <p className="field-warning">
              Qty × Unit Cost is {formatCurrency(unitMismatch.expected)}, but{" "}
              {MONEY.cost.label.toLowerCase()} is{" "}
              {formatCurrency(unitMismatch.actual)}.{" "}
              <button
                type="button"
                className="font-semibold underline"
                onClick={fillActualFromUnit}
              >
                Use {formatCurrency(unitMismatch.expected)}
              </button>
            </p>
          )}

          <button
            type="button"
            className="btn-secondary btn-sm mt-2.5 w-full"
            onClick={fillActualFromUnit}
          >
            Use Qty × Unit cost as {MONEY.cost.label.toLowerCase()}
          </button>
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="vat_rate">
            VAT rate <span className="text-red-500">*</span>
          </label>
          <Select
            id="vat_rate"
            title="VAT rate"
            value={String(form.vat_rate)}
            onChange={(v) => set("vat_rate", v)}
            options={VAT_RATES.map((r) => ({
              value: String(r),
              label: `${r}%`,
            }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="status">
            Status <span className="text-red-500">*</span>
          </label>
          <Select
            id="status"
            title="Status"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={EXPENSE_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </div>
      </div>

      {/* Everything below is optional — collapsed by default to keep a quick
          on-site entry short. */}
      <button
        type="button"
        onClick={() => setShowMore((s) => !s)}
        className="flex min-h-touch w-full items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 text-left text-sm font-semibold text-gray-700 shadow-card transition active:bg-gray-50"
        aria-expanded={showMore}
      >
        <span>Date paid, payment method, room, notes &amp; receipt</span>
        <Icon
          name={showMore ? "chevronUp" : "chevronDown"}
          size={18}
          className="shrink-0 text-gray-400"
        />
      </button>

      {showMore && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="paid_amount_date">
                Date paid
              </label>
              <DatePicker
                id="paid_amount_date"
                title="Date paid"
                placeholder="Not paid yet"
                value={form.paid_date ?? ""}
                onChange={(v) => set("paid_date", v)}
              />
            </div>
            <div>
              <label className="label" htmlFor="payment_method">
                Payment method
              </label>
              <Select
                id="payment_method"
                title="Payment method"
                placeholder="Not recorded"
                clearable
                value={form.payment_method}
                onChange={(v) => set("payment_method", v)}
                options={PAYMENT_METHODS.map((p) => ({ value: p, label: p }))}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              className="textarea"
              rows={2}
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {/* Receipt upload. A bare `<input type="file">` renders as an
              unstyled OS button with the filename beside it — the one control
              on the form that looked like a different application. The input
              is still there, just invisible behind a label. */}
          <div>
            <label className="label">Receipt</label>
            {receiptUrl ? (
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 shadow-card">
                <Icon name="link" size={17} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
                  Receipt attached
                </span>
                <button
                  type="button"
                  onClick={removeReceipt}
                  className="btn-ghost btn-sm shrink-0 text-red-600"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-white px-3.5 py-3 transition active:bg-gray-50">
                <Icon name="camera" size={19} className="shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-800">
                    {file ? file.name : "Take a photo or choose a file"}
                  </span>
                  <span className="block text-xs text-gray-500">
                    Image or PDF, up to 10MB
                  </span>
                </span>
                <input
                  type="file"
                  accept={ACCEPT}
                  capture="environment"
                  aria-label="Receipt file"
                  className="sr-only"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
        </div>
      )}

      {/* Live totals. Owed is the figure this panel exists for, so it is the
          only one set at full size — the three above it are the working. */}
      <div className="overflow-hidden rounded-2xl bg-brand-50 ring-1 ring-inset ring-brand-600/10">
        <dl className="space-y-1.5 px-4 pb-3 pt-3.5 text-[0.8125rem]">
          <div className="flex justify-between gap-3">
            <dt className="text-brand-900/60">Subtotal (ex VAT)</dt>
            <dd className="tnum font-semibold text-brand-900">
              {formatCurrency(calc.subtotal)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-brand-900/60">VAT ({form.vat_rate}%)</dt>
            <dd className="tnum font-semibold text-brand-900">
              {formatCurrency(calc.vatAmount)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-brand-900/60">{MONEY.cost.label} (incl VAT)</dt>
            <dd className="tnum font-semibold text-brand-900">
              {formatCurrency(calc.totalInclVat)}
            </dd>
          </div>
        </dl>
        <div className="flex items-baseline justify-between gap-3 border-t border-brand-600/10 px-4 py-3">
          <span className="text-sm font-bold text-brand-900">
            {MONEY.owed.label}
          </span>
          <span className="tnum text-xl font-bold tracking-[-0.02em] text-brand-800">
            {formatCurrency(calc.remaining)}
          </span>
        </div>
      </div>

      {/* Pinned to the bottom of the drawer on a phone, with the primary action
          taking the width it can get. */}
      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Add expense"}
        </button>
      </div>
    </form>
  );
}

/**
 * A money input with the currency inside the field.
 *
 * Three of these used to be labelled "Amounts (£)" once, above the group — so
 * each individual field was just a number box, and on a phone, where they are
 * stacked and scrolled past one at a time, the £ had usually scrolled away.
 */
function MoneyField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-gray-400">
          £
        </span>
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="0.00"
          className={`input tnum pl-8 ${error ? "input-invalid" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}
