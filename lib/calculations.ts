// Cost calculation helpers.
// Costs are entered directly as Quoted / Actual / Paid amounts (matching the
// user's real spend tracker). total_incl_vat is NOT stored — computed on read.

import type { ExpenseEntry, ExpenseEntryComputed } from "@/types";

// Materials helper — used to auto-suggest the Actual amount from qty × unit cost.
export function calcMaterialsCost(qty: number, unitCost: number): number {
  if (qty > 0 && unitCost > 0) return qty * unitCost;
  return 0;
}

export function calcTotal(actual: number, vatRate: number) {
  const subtotal = actual;
  const vatAmount = subtotal * (vatRate / 100);
  return { subtotal, vatAmount, totalInclVat: subtotal + vatAmount };
}

// Attach computed cost fields to a raw expense entry.
export function computeEntry(e: ExpenseEntry): ExpenseEntryComputed {
  const actual = Number(e.actual_amount);
  const materials_cost = calcMaterialsCost(Number(e.qty), Number(e.unit_cost));
  const { subtotal, vatAmount, totalInclVat } = calcTotal(actual, Number(e.vat_rate));
  return {
    ...e,
    materials_cost,
    subtotal,
    vat_amount: vatAmount,
    total_incl_vat: totalInclVat,
    // Paid amounts are what was actually handed over, which includes VAT, so
    // what is still owed is measured against the incl-VAT total. This matches
    // buildTrades and buildMaterials, which already subtract paid from an
    // incl-VAT figure.
    remaining: totalInclVat - Number(e.paid_amount),
  };
}

export function computeEntries(entries: ExpenseEntry[]): ExpenseEntryComputed[] {
  return entries.map(computeEntry);
}

// ============================================================
// Payment state — derived, never stored
// ============================================================
// `status` is a lifecycle label a human sets; `paid_amount` is money. They used
// to be able to disagree — a row could say Paid with nothing paid against it,
// or be fully paid and still offer a "Mark Paid" button. This is the single
// answer to "how much of this has actually been handed over", and every screen
// reads it rather than re-deriving its own version.
//
//   None    — Cancelled: the question does not apply.
//   Paid    — settled, within half a penny.
//   Partial — something has been paid, but not all of it.
//   Unpaid  — nothing has been paid, whatever the status label says.
export type PaidState = "None" | "Unpaid" | "Partial" | "Paid";

// Half a penny of slack: money is stored to the penny, so anything closer than
// this is float noise rather than an outstanding balance.
export const PAID_TOLERANCE = 0.005;

export function paidState(e: {
  status: string;
  paid_amount: number | string;
  total_incl_vat: number;
}): PaidState {
  if (e.status === "Cancelled") return "None";
  const paid = Number(e.paid_amount);
  // `paid > 0` guards the zero-total row: an entry quoted but not yet costed
  // has a total of £0, and without this it would read as Paid the moment it was
  // created. Same rule purchaseStatus() uses in lib/purchases.ts.
  if (paid > 0 && paid >= Number(e.total_incl_vat) - PAID_TOLERANCE) return "Paid";
  if (paid > 0) return "Partial";
  return "Unpaid";
}

// £ formatting — 2 decimal places with £ prefix.
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPct(value: number): string {
  return `${Number(value ?? 0).toFixed(0)}%`;
}
