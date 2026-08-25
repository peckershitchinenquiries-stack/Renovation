"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateLabourEntry, hasErrors, todayISO } from "@/lib/validation";
import { formatCurrency } from "@/lib/calculations";
import { round2 } from "@/lib/purchases";
import { safeReturnTo } from "@/lib/safeReturnTo";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/States";
import TradeSelect from "@/components/forms/TradeSelect";
import {
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  VAT_RATES,
  type TradeLookup,
} from "@/types";

// Logging labour by hand.
//
// Deliberately not PurchaseForm. That form is about a document — a supplier, an
// invoice number, N lines, N payments — and none of that is what a day's labour
// looks like. This asks the five things you actually know standing on site (who,
// what trade, what rate, how many hours, what you paid them) and turns them into
// one perfectly ordinary purchase with a single Labour line, so nothing
// downstream has to know it was typed here rather than read off an invoice.
//
// Two numbers are prefilled and then left alone once touched:
//
//   • Total pay starts as rate × hours, but it is what YOU typed that gets
//     stored. A day that ran over, a cash discount, a rounded-up figure — all
//     real, and none of them arithmetic. When the two disagree the form says so
//     and offers a one-click fix; it never quietly recomputes over the figure.
//   • The payment amount starts as the gross (total pay + VAT) and follows both
//     of them until you edit it. Editing it below gross records a part payment,
//     which is a real thing (a deposit against a labour bill), so it saves — with
//     a note about what the Trades and Suppliers screens will then show.

interface Props {
  projectId: string;
  trades: TradeLookup[];
  // Where Save and Cancel should land. Validated by the page before it gets
  // here, and validated again on the way to router.push() — a redirect target
  // is the kind of thing that should fail closed twice.
  returnTo?: string;
}

const blank = () => ({
  name: "",
  trade: "",
  rate: "",
  hours: "",
  total_pay: "",
  // Never silently defaulted: 0 is a real answer here (most of this work is
  // not VAT registered), so the label says so out loud rather than leaving an
  // unanswered field looking answered.
  vat_rate: "0",
  status: "Planned" as (typeof EXPENSE_STATUSES)[number],
  notes: "",
  paid_on: todayISO(),
  payment_method: "",
  paid_amount: "",
});

const asNumber = (value: string): number => {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : 0;
};

export default function LabourForm({ projectId, trades, returnTo }: Props) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Local copy so a trade added inline shows up in this dropdown immediately,
  // the same way ExpenseForm handles it.
  const [tradeList, setTradeList] = useState<TradeLookup[]>(trades);
  // Once either of these has been typed in, it stops following its formula.
  // The formula is a convenience, not a constraint.
  const [totalTouched, setTotalTouched] = useState(false);
  const [amountTouched, setAmountTouched] = useState(false);

  const safeTarget = safeReturnTo(returnTo);
  const fallback = `/projects/${projectId}?tab=labour`;

  const expectedTotal = useMemo(
    () => round2(asNumber(form.rate) * asNumber(form.hours)),
    [form.rate, form.hours]
  );

  // Ex-VAT, VAT and gross, computed exactly as purchaseTotalsFromLines will
  // compute them on save, so the figure on screen is the figure stored.
  const money = useMemo(() => {
    const net = round2(asNumber(form.total_pay));
    const vat = round2((net * asNumber(form.vat_rate)) / 100);
    return { net, vat, gross: round2(net + vat) };
  }, [form.total_pay, form.vat_rate]);

  const isPaid = form.status === "Paid";

  // What the payment box should say, until someone says otherwise.
  const suggestedAmount = money.gross;
  const amountValue = amountTouched
    ? form.paid_amount
    : suggestedAmount > 0
      ? String(suggestedAmount)
      : "";

  // Rate × hours and total pay should normally agree; more than a penny apart
  // means one of the three numbers was mistyped. Advisory only — mirrors the
  // unitMismatch check in ExpenseForm.
  const totalMismatch = useMemo(() => {
    const typed = asNumber(form.total_pay);
    if (expectedTotal <= 0 || form.total_pay.trim() === "") return null;
    if (Math.abs(expectedTotal - typed) < 0.01) return null;
    return { expected: expectedTotal, typed };
  }, [expectedTotal, form.total_pay]);

  // Paying less than the bill is a deposit, not a mistake — but it leaves a
  // balance on two other screens while this entry reads "Paid", and that is
  // surprising enough to say out loud.
  const partPayment = useMemo(() => {
    if (!isPaid) return null;
    const amount = asNumber(amountValue);
    if (amount <= 0 || money.gross <= 0) return null;
    if (money.gross - amount < 0.01) return null;
    return { amount, gross: money.gross, shortfall: round2(money.gross - amount) };
  }, [isPaid, amountValue, money.gross]);

  function set(field: keyof ReturnType<typeof blank>, value: string) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Total pay follows rate × hours until it has been edited by hand.
      if ((field === "rate" || field === "hours") && !totalTouched) {
        const computed = round2(
          asNumber(field === "rate" ? value : next.rate) *
            asNumber(field === "hours" ? value : next.hours)
        );
        next.total_pay = computed > 0 ? String(computed) : "";
      }
      return next;
    });
  }

  function useRateTimesHours() {
    setForm((f) => ({ ...f, total_pay: String(expectedTotal) }));
    // Back in step with the formula, so let it keep following again.
    setTotalTouched(false);
  }

  // The payload the route handler and validateLabourEntry both read. Built once
  // so the client cannot validate a different object from the one it sends.
  function buildPayload() {
    return {
      name: form.name.trim(),
      trade: form.trade.trim(),
      rate: form.rate,
      hours: form.hours,
      total_pay: form.total_pay,
      vat_rate: form.vat_rate,
      status: form.status,
      notes: form.notes.trim() || null,
      // Only sent when Paid. The other three statuses write no payment row at
      // all, so sending a date and a method would be describing something that
      // did not happen.
      paid_on: isPaid ? form.paid_on : null,
      payment_method: isPaid ? form.payment_method : null,
      paid_amount: isPaid ? amountValue : "",
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = buildPayload();
    const v = validateLabourEntry(payload);
    setErrors(v);
    if (hasErrors(v)) {
      toast("Check the highlighted fields", "error");
      return;
    }

    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/labour`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      toast("Labour logged", "success");
      router.push(safeTarget ?? fallback);
      router.refresh();
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
      <div>
        <label className="label" htmlFor="labour_name">
          Name *
        </label>
        <input
          id="labour_name"
          className="input"
          maxLength={200}
          autoComplete="off"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. Dave Gardener, Owen Brickwork"
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
        <p className="mt-1 text-xs text-gray-400">
          The worker or subcontractor who did the work. Recorded against the job
          itself, not as a supplier account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="labour_trade">
            Trade *
          </label>
          <TradeSelect
            id="labour_trade"
            value={form.trade}
            trades={tradeList}
            onChange={(name) => set("trade", name)}
            onTradeAdded={(t) => setTradeList((list) => [...list, t])}
          />
          {errors.trade && <p className="field-error">{errors.trade}</p>}
        </div>
        <div>
          <label className="label" htmlFor="labour_status">
            Status *
          </label>
          <select
            id="labour_status"
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
          {errors.status && <p className="field-error">{errors.status}</p>}
        </div>
      </div>

      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
          The work
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="labour_rate">
              Rate (£/hr) *
            </label>
            <input
              id="labour_rate"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="input"
              value={form.rate}
              onChange={(e) => set("rate", e.target.value)}
            />
            {errors.rate && <p className="field-error">{errors.rate}</p>}
          </div>
          <div>
            <label className="label" htmlFor="labour_hours">
              Total hours worked *
            </label>
            <input
              id="labour_hours"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.25"
              className="input"
              value={form.hours}
              onChange={(e) => set("hours", e.target.value)}
            />
            {errors.hours && <p className="field-error">{errors.hours}</p>}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="labour_total_pay">
              Total pay (£, ex VAT) *
            </label>
            <input
              id="labour_total_pay"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className="input"
              value={form.total_pay}
              onChange={(e) => {
                setTotalTouched(true);
                set("total_pay", e.target.value);
              }}
            />
            {errors.total_pay && <p className="field-error">{errors.total_pay}</p>}
            {totalMismatch && (
              <p className="field-warning">
                Rate × hours is {formatCurrency(totalMismatch.expected)}, but
                total pay is {formatCurrency(totalMismatch.typed)}.{" "}
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={useRateTimesHours}
                >
                  Use {formatCurrency(totalMismatch.expected)}
                </button>
              </p>
            )}
            {!totalMismatch && (
              <p className="mt-1 text-xs text-gray-400">
                Prefilled from rate × hours. What you type here is what gets
                saved.
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="labour_vat_rate">
              VAT rate *
            </label>
            <select
              id="labour_vat_rate"
              className="input"
              value={form.vat_rate}
              onChange={(e) => set("vat_rate", e.target.value)}
            >
              {VAT_RATES.map((r) => (
                <option key={r} value={r}>
                  {r === 0 ? "0% — not VAT registered" : `${r}%`}
                </option>
              ))}
            </select>
            {errors.vat_rate && <p className="field-error">{errors.vat_rate}</p>}
          </div>
        </div>
      </fieldset>

      {/* Only shown when the money has actually changed hands. Switching the
          status back hides it again and no payment row is written. */}
      {isPaid && (
        <fieldset className="rounded-lg border border-gray-200 p-3">
          <legend className="px-1 text-xs font-semibold uppercase text-gray-500">
            Payment
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="labour_paid_on">
                Date of payment *
              </label>
              <input
                id="labour_paid_on"
                type="date"
                className="input"
                max={todayISO()}
                value={form.paid_on}
                onChange={(e) => set("paid_on", e.target.value)}
              />
              {errors.paid_on && <p className="field-error">{errors.paid_on}</p>}
            </div>
            <div>
              <label className="label" htmlFor="labour_payment_method">
                Payment method *
              </label>
              <select
                id="labour_payment_method"
                className="input"
                value={form.payment_method}
                onChange={(e) => set("payment_method", e.target.value)}
              >
                <option value="">— Pick one —</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {errors.payment_method && (
                <p className="field-error">{errors.payment_method}</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="labour_paid_amount">
                Amount (£, incl VAT) *
              </label>
              <input
                id="labour_paid_amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                className="input"
                value={amountValue}
                onChange={(e) => {
                  setAmountTouched(true);
                  set("paid_amount", e.target.value);
                }}
              />
              {errors.paid_amount && (
                <p className="field-error">{errors.paid_amount}</p>
              )}
              {!amountTouched && !errors.paid_amount && (
                <p className="mt-1 text-xs text-gray-400">
                  Filled from the total incl. VAT — change it if you paid a
                  different sum.
                </p>
              )}
            </div>
          </div>

          {partPayment && (
            <p className="field-warning">
              {formatCurrency(partPayment.amount)} of{" "}
              {formatCurrency(partPayment.gross)} — this records a part payment,
              so Trades and Suppliers will show{" "}
              {formatCurrency(partPayment.shortfall)} still outstanding even
              though the status reads Paid. Save it if that is right.
            </p>
          )}
        </fieldset>
      )}

      <div>
        <label className="label" htmlFor="labour_notes">
          Notes
        </label>
        <textarea
          id="labour_notes"
          className="input"
          rows={2}
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          placeholder="Anything worth remembering about this stint of work"
        />
      </div>

      {/* Live totals, in the same order the header will store them. */}
      <div className="rounded-lg bg-brand-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Total pay (ex VAT)</span>
          <span className="font-medium">{formatCurrency(money.net)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-600">VAT ({form.vat_rate}%)</span>
          <span className="font-medium">{formatCurrency(money.vat)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-brand-100 pt-1 text-base font-bold text-brand">
          <span>Total incl. VAT</span>
          <span>{formatCurrency(money.gross)}</span>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0">
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving && <Spinner />}
          Log labour
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push(safeTarget ?? fallback)}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
