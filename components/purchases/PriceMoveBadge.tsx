import React from "react";
import { Icon } from "@/components/ui/Icon";
import type { PriceMove } from "@/types";

// The unit-price change against the previous purchase of the same item.
//
// The 'unit_change' case is the reason this component exists rather than
// reusing the TrendBadge inside PricesTab: when the unit changed there is no
// honest percentage, so it must never render one. A price alert that lies once
// gets ignored for ever (evolution summary, "Unit handling").
export function PriceMoveBadge({
  move,
  deltaPct,
  unit,
  previousUnit,
}: {
  move: PriceMove;
  deltaPct: number | null;
  unit?: string | null;
  previousUnit?: string | null;
}) {
  // One pill shape for all five outcomes, so a column of these lines up and a
  // rise is told apart from a fall by colour AND by the arrow — never colour
  // alone, which a red/green-blind reader cannot use.
  const pill =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-bold leading-none ring-1 ring-inset";

  if (move === "unit_change") {
    const from = previousUnit?.trim() || "not recorded";
    const to = unit?.trim() || "not recorded";
    return (
      <span
        className={`${pill} bg-amber-50 text-amber-800 ring-amber-600/20`}
        title="The unit changed, so no honest percentage exists"
      >
        {from} → {to}
      </span>
    );
  }
  if (move === "first" || deltaPct === null)
    return (
      <span className={`${pill} bg-gray-100 text-gray-500 ring-gray-500/15`}>
        first buy
      </span>
    );
  if (move === "up")
    return (
      <span className={`${pill} tnum bg-red-50 text-red-700 ring-red-600/15`}>
        <Icon name="arrowUp" size={11} strokeWidth={3} />+{deltaPct.toFixed(1)}%
      </span>
    );
  if (move === "down")
    return (
      <span
        className={`${pill} tnum bg-emerald-50 text-emerald-700 ring-emerald-600/15`}
      >
        <Icon name="arrowDown" size={11} strokeWidth={3} />
        {deltaPct.toFixed(1)}%
      </span>
    );
  return (
    <span className={`${pill} bg-gray-100 text-gray-500 ring-gray-500/15`}>
      no change
    </span>
  );
}
