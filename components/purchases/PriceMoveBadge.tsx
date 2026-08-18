import React from "react";
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
  if (move === "unit_change") {
    const from = previousUnit?.trim() || "not recorded";
    const to = unit?.trim() || "not recorded";
    return (
      <span className="text-amber-700">
        {from} → {to} — check pack size
      </span>
    );
  }
  if (move === "first" || deltaPct === null)
    return <span className="text-gray-400">first buy</span>;
  if (move === "up")
    return (
      <span className="font-medium text-red-600">▲ +{deltaPct.toFixed(1)}%</span>
    );
  if (move === "down")
    return (
      <span className="font-medium text-emerald-600">
        ▼ {deltaPct.toFixed(1)}%
      </span>
    );
  return <span className="text-gray-500">no change</span>;
}
