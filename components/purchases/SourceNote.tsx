import React from "react";
import { Icon } from "@/components/ui/Icon";

// Where an invoice logged here does — and does not — show up.
//
// The Overview and Costs tabs read expense_entries; invoices are stored in the
// transaction core instead
// (about.md §4.6). Nothing writes to both, on purpose: the two would then hold
// the same spend twice and every project total would be wrong. Until the
// switchover, that means a new invoice is genuinely absent from the Overview
// cards, and saying so here is better than letting it be discovered.
export function InvoiceScopeNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`flex items-start gap-2.5 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-600/15 ${className}`}
    >
      <Icon name="info" size={15} className="mt-0.5 shrink-0" />
      <span>
        Invoices logged here appear on this page and on the{" "}
        <span className="font-bold">Suppliers</span> and{" "}
        <span className="font-bold">Items</span> screens. They do{" "}
        <span className="font-bold">not</span> yet feed the project&rsquo;s
        Overview or Expenses tabs, which still read the older week-by-week rows
        — writing to both would count the same spend twice.
      </span>
    </p>
  );
}
