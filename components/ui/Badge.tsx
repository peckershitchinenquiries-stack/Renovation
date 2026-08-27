import React from "react";

const STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-gray-200 text-gray-700",
  paused: "bg-amber-100 text-amber-800",
  Paid: "bg-emerald-100 text-emerald-800",
  Partial: "bg-amber-100 text-amber-800",
  Pending: "bg-gray-200 text-gray-700",
  Planned: "bg-blue-100 text-blue-800",
  "In Progress": "bg-amber-100 text-amber-800",
  Cancelled: "bg-red-100 text-red-700",
  // A row in the Expenses list that is really an invoice, so it is clear why
  // its Edit opens a different form.
  Invoice: "bg-violet-100 text-violet-800",
  // invoice_uploads.status = 'needs_triage' (migration 0013): arrived by
  // email from a sender who is not a declared supplier, so it was held rather
  // than read. Amber, like "In Progress" — it needs a person, but nothing has
  // gone wrong.
  "Waiting to be checked": "bg-amber-100 text-amber-800",
  // The three labels on the "Invoices from email" list
  // (components/invoices/EmailInvoices.tsx). Read and waiting for a person is
  // the good outcome, so it is green like "Paid"; a read that failed is red
  // like "Cancelled"; still reading is neutral, because nothing has gone wrong
  // and nothing needs doing.
  "Ready to review": "bg-emerald-100 text-emerald-800",
  "Still reading": "bg-gray-200 text-gray-700",
  "Couldn't be read": "bg-red-100 text-red-700",
};

export function Badge({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STYLES[label] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {label}
    </span>
  );
}
