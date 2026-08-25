// Shared validation (runs both client-side and server-side per requirements §10).
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  VAT_RATES_SENTENCE,
  isVatRate,
} from "@/types";

export type ValidationErrors = Record<string, string>;

const num = (v: unknown) => (v === "" || v == null ? 0 : Number(v));

export function validateProject(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};
  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Name is required";
  if (name.length > 200) errors.name = "Max 200 characters";
  if (num(data.target_budget) < 0) errors.target_budget = "Must be non-negative";
  if (data.status && !["active", "completed", "paused"].includes(String(data.status)))
    errors.status = "Invalid status";
  return errors;
}

export function validateExpense(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const week = num(data.week_number);
  if (!Number.isInteger(week) || week < 1)
    errors.week_number = "Week must be a positive integer";

  const description = String(data.description ?? "").trim();
  if (!description) errors.description = "Description is required";
  if (description.length > 200) errors.description = "Max 200 characters";

  if (data.category && !EXPENSE_CATEGORIES.includes(data.category as never))
    errors.category = "Invalid category";

  if (num(data.quoted_amount) < 0) errors.quoted_amount = "Must be non-negative";
  if (num(data.actual_amount) < 0) errors.actual_amount = "Must be non-negative";
  if (num(data.paid_amount) < 0) errors.paid_amount = "Must be non-negative";
  if (num(data.qty) < 0) errors.qty = "Must be non-negative";
  if (num(data.unit_cost) < 0) errors.unit_cost = "Must be non-negative";

  if (!isVatRate(num(data.vat_rate)))
    errors.vat_rate = `VAT must be ${VAT_RATES_SENTENCE}`;

  if (!EXPENSE_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (
    data.payment_method &&
    !PAYMENT_METHODS.includes(data.payment_method as never)
  )
    errors.payment_method = "Invalid payment method";

  return errors;
}

// A real date column will reject anything else, so catch it here first.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isDate = (value: unknown): boolean => {
  const text = String(value ?? "").trim();
  if (!ISO_DATE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
};

// Today, in the same UTC-day terms the rest of the app already uses when it
// defaults a paid date (lib/… and the Mark Paid route both do
// `toISOString().slice(0, 10)`). Deliberately shared so the client form and the
// route handler agree on where "the future" starts, rather than one of them
// rejecting a date the other had just filled in.
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

// A multi-line purchase: one document header, N lines, and 0..N payments.
//
// Errors on a nested row are keyed `lines.0.qty` / `payments.1.amount` so the
// form can put the message under the field it belongs to. Every rule here
// mirrors a CHECK constraint from migration 0008 — those reject rather than
// coerce (about.md §2 rule 4), so anything this misses becomes a 500 instead
// of a field error.
export function validatePurchase(data: Record<string, unknown>): ValidationErrors {
  const errors: ValidationErrors = {};

  const supplier = String(data.supplier_name ?? "").trim();
  if (supplier.length > 200) errors.supplier_name = "Max 200 characters";

  const week = data.week_no;
  if (week !== null && week !== undefined && String(week).trim() !== "") {
    const n = num(week);
    if (!Number.isInteger(n) || n < 1)
      errors.week_no = "Week must be a positive whole number";
  }

  if (data.purchase_date && !isDate(data.purchase_date))
    errors.purchase_date = "Use a real date";

  if (data.category && !EXPENSE_CATEGORIES.includes(data.category as never))
    errors.category = "Invalid category";

  if (!EXPENSE_STATUSES.includes(data.entry_status as never))
    errors.entry_status = "Invalid status";

  const lines = Array.isArray(data.lines) ? data.lines : [];
  if (lines.length === 0) errors.lines = "An invoice needs at least one line";

  lines.forEach((raw, i) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const description = String(line.description_raw ?? "").trim();
    if (!description) errors[`lines.${i}.description_raw`] = "Required";
    else if (description.length > 200)
      errors[`lines.${i}.description_raw`] = "Max 200 characters";

    if (num(line.qty) < 0) errors[`lines.${i}.qty`] = "Must be non-negative";
    if (num(line.unit_price) < 0)
      errors[`lines.${i}.unit_price`] = "Must be non-negative";
    if (num(line.line_net) < 0)
      errors[`lines.${i}.line_net`] = "Must be non-negative";

    // Blank is its own error, not a zero. The invoice review screen leaves the
    // rate empty when the document printed one the database will not take —
    // saying "pick it" is the whole point of that, and `num("")` would
    // otherwise quietly turn it into 0% and lose the VAT.
    const vat = String(line.vat_rate ?? "").trim();
    if (vat === "")
      errors[`lines.${i}.vat_rate`] = "Pick the VAT rate printed on the invoice";
    else if (!isVatRate(num(vat)))
      errors[`lines.${i}.vat_rate`] = `VAT must be ${VAT_RATES_SENTENCE}`;
  });

  const payments = Array.isArray(data.payments) ? data.payments : [];
  payments.forEach((raw, i) => {
    const payment = (raw ?? {}) as Record<string, unknown>;
    const amount = num(payment.amount);
    if (amount < 0) errors[`payments.${i}.amount`] = "Must be non-negative";
    // A payment of nothing is not a payment. The form drops blank rows before
    // sending, so reaching here means a figure was cleared but the row kept.
    if (amount === 0) errors[`payments.${i}.amount`] = "Enter what was paid";
    if (payment.paid_on && !isDate(payment.paid_on))
      errors[`payments.${i}.paid_on`] = "Use a real date";
    if (payment.method && !PAYMENT_METHODS.includes(payment.method as never))
      errors[`payments.${i}.method`] = "Invalid payment method";
  });

  return errors;
}

// A day's labour, logged by hand rather than off an invoice.
//
// This is a *narrower* form than validatePurchase, not a different one: it ends
// up as one ordinary purchase with a single Labour line, so every rule below
// still mirrors the same CHECK constraints from migration 0008. It exists
// separately because the fields the user actually types (a name, a rate, hours,
// a total) are not the fields a purchase stores, and mapping one to the other
// is the route handler's job — see app/api/projects/[id]/labour/route.ts.
//
// The payment block is conditional on purpose. Only a status of Paid writes a
// payments row, so only a status of Paid has payment fields to check; the other
// three statuses must not be made to invent a date or a method they do not have.
export function validateLabourEntry(
  data: Record<string, unknown>
): ValidationErrors {
  const errors: ValidationErrors = {};

  const name = String(data.name ?? "").trim();
  if (!name) errors.name = "Who did the work?";
  else if (name.length > 200) errors.name = "Max 200 characters";

  const trade = String(data.trade ?? "").trim();
  if (!trade) errors.trade = "Pick a trade, or add a new one";

  // Blank is an error rather than a zero for the same reason vat_rate is: an
  // unanswered field and a deliberate nil are not the same thing.
  const rate = String(data.rate ?? "").trim();
  if (rate === "") errors.rate = "Enter the hourly rate";
  else if (!Number.isFinite(Number(rate)) || Number(rate) < 0)
    errors.rate = "Must be non-negative";

  const hours = String(data.hours ?? "").trim();
  if (hours === "") errors.hours = "Enter the hours worked";
  else if (!Number.isFinite(Number(hours)) || Number(hours) <= 0)
    errors.hours = "Must be more than zero";

  const totalPay = String(data.total_pay ?? "").trim();
  if (totalPay === "") errors.total_pay = "Enter the total pay";
  else if (!Number.isFinite(Number(totalPay)) || Number(totalPay) < 0)
    errors.total_pay = "Must be non-negative";

  // Same rule as a purchase line: a blank rate is a question nobody answered,
  // and num("") would quietly turn it into 0% and lose the VAT.
  const vat = String(data.vat_rate ?? "").trim();
  if (vat === "") errors.vat_rate = "Pick the VAT rate";
  else if (!isVatRate(num(vat))) errors.vat_rate = `VAT must be ${VAT_RATES_SENTENCE}`;

  if (!EXPENSE_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (data.status === "Paid") {
    const paidOn = String(data.paid_on ?? "").trim();
    if (!paidOn) errors.paid_on = "When was it paid?";
    else if (!isDate(paidOn)) errors.paid_on = "Use a real date";
    else if (paidOn > todayISO()) errors.paid_on = "That date is in the future";

    if (!PAYMENT_METHODS.includes(data.payment_method as never))
      errors.payment_method = "Pick how it was paid";

    const amount = String(data.paid_amount ?? "").trim();
    if (amount === "") errors.paid_amount = "Enter what was handed over";
    else if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      errors.paid_amount = "Enter what was handed over";
  }

  return errors;
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
