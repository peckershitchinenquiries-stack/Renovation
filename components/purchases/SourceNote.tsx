import React from "react";

// Where an invoice logged here does — and does not — show up.
//
// The project tabs (Overview, Expenses, Trades, Materials, Price Tracker) all
// read expense_entries; invoices are stored in the transaction core instead
// (about.md §4.6). Nothing writes to both, on purpose: the two would then hold
// the same spend twice and every project total would be wrong. Until the
// switchover, that means a new invoice is genuinely absent from the Overview
// cards, and saying so here is better than letting it be discovered.
export function InvoiceScopeNote({ className = "" }: { className?: string }) {
  return (
    <p
      className={`rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ${className}`}
    >
      Invoices logged here appear on this page and on the{" "}
      <span className="font-medium">Suppliers</span> and{" "}
      <span className="font-medium">Items</span> screens. They do{" "}
      <span className="font-medium">not</span> yet feed the project&rsquo;s
      Overview or Expenses tabs, which still read the older week-by-week rows —
      writing to both would count the same spend twice.
    </p>
  );
}
