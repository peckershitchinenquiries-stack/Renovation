"use client";

import { formatCurrency } from "@/lib/calculations";
import type { CostImpact } from "@/types";

/**
 * What a delay costs, shown where the delay is being made.
 *
 * The spec asks for the cost implication to appear **inline** when a task is
 * dragged or edited — not in a separate spreadsheet — and this is that.
 *
 * The important behaviour is the empty case. When nothing on file can price
 * the delay it says so, in words, instead of showing £0. A delay that reads as
 * free is worse than a delay with no number on it: £0 is exactly the kind of
 * figure that gets quoted at a client and later turns out to be invented. The
 * chip also prints its working (`basis`), so the reader can see it used the
 * trade's default hourly rate × 8 and take it for the estimate it is.
 */
export function CostImpactChip({
  impact,
  className = "",
}: {
  impact: CostImpact;
  className?: string;
}) {
  if (impact.days <= 0) return null;

  const dayLabel = `+${impact.days} ${impact.days === 1 ? "day" : "days"}`;

  if (impact.unpriced)
    return (
      <span
        className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-gray-100
          px-2.5 py-1.5 text-xs font-medium text-gray-600 ${className}`}
      >
        <span className="font-bold text-gray-800">{dayLabel}</span>
        <span>no rate on file — no cost estimate</span>
      </span>
    );

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-amber-50
        px-2.5 py-1.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-600/20 ${className}`}
    >
      <span className="font-bold">{dayLabel}</span>
      <span className="tnum font-bold">+{formatCurrency(impact.total)}</span>
      {/* The working, so the number can be argued with rather than believed. */}
      <span className="text-amber-800/80">{impact.basis.join(" · ")}</span>
    </span>
  );
}
