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

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
