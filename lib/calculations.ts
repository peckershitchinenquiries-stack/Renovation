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
    remaining: actual - Number(e.paid_amount),
  };
}

export function computeEntries(entries: ExpenseEntry[]): ExpenseEntryComputed[] {
  return entries.map(computeEntry);
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
