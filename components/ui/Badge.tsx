import React from "react";

/**
 * Status pills.
 *
 * Every label in the app maps to one of five *meanings*, not five arbitrary
 * colours: settled (green), needs a person (amber), not started (blue),
 * inactive (grey), failed (red). Adding a new label means deciding which of
 * those it is — which is why the tones are named rather than written as
 * classnames at each entry.
 */
const TONES = {
  good: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  warn: "bg-amber-50 text-amber-800 ring-amber-600/20",
  info: "bg-blue-50 text-blue-700 ring-blue-600/15",
  neutral: "bg-gray-100 text-gray-600 ring-gray-500/15",
  bad: "bg-red-50 text-red-700 ring-red-600/15",
  accent: "bg-violet-50 text-violet-700 ring-violet-600/15",
} as const;

type Tone = keyof typeof TONES;

const STYLES: Record<string, Tone> = {
  active: "good",
  completed: "neutral",
  paused: "warn",
  Paid: "good",
  Partial: "warn",
  Pending: "neutral",
  Planned: "info",
  "In Progress": "warn",
  Cancelled: "bad",
  // A row in the Expenses list that is really an invoice, so it is clear why
  // its Edit opens a different form.
  Invoice: "accent",
  // invoice_uploads.status = 'needs_triage' (migration 0013): arrived by
  // email from a sender who is not a declared supplier, so it was held rather
  // than read. Amber, like "In Progress" — it needs a person, but nothing has
  // gone wrong.
  "Waiting to be checked": "warn",
  // The three labels on the "Invoices from email" list
  // (components/invoices/EmailInvoices.tsx). Read and waiting for a person is
  // the good outcome, so it is green like "Paid"; a read that failed is red
  // like "Cancelled"; still reading is neutral, because nothing has gone wrong
  // and nothing needs doing.
  "Ready to review": "good",
  "Still reading": "neutral",
  "Couldn't be read": "bad",
};

export function Badge({
  label,
  tone,
  className = "",
}: {
  label: string;
  /** Overrides the lookup — for labels that are not statuses. */
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1
        text-2xs font-semibold leading-none ring-1 ring-inset
        ${TONES[tone ?? STYLES[label] ?? "neutral"]} ${className}`}
    >
      {label}
    </span>
  );
}

/**
 * A badge with a coloured dot instead of a filled background — for use inside
 * dense list rows, where a wall of filled pills becomes visual noise.
 */
export function DotBadge({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  const dot =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-500"
        : tone === "bad"
          ? "bg-red-500"
          : tone === "info"
            ? "bg-blue-500"
            : tone === "accent"
              ? "bg-violet-500"
              : "bg-gray-400";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
