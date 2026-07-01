// Shared validation (runs both client-side and server-side per requirements §10).
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS } from "@/types";

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

  const vat = num(data.vat_rate);
  if (vat !== 0 && vat !== 20) errors.vat_rate = "VAT must be 0 or 20";

  if (!EXPENSE_STATUSES.includes(data.status as never))
    errors.status = "Invalid status";

  if (
    data.payment_method &&
    !PAYMENT_METHODS.includes(data.payment_method as never)
  )
    errors.payment_method = "Invalid payment method";

  return errors;
}

export function hasErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
