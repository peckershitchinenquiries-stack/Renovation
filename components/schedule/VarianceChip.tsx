"use client";

import { formatCurrency } from "@/lib/calculations";
import type { PhaseCostRow, ProjectCostRollup, TaskCostRow } from "@/types";

/**
 * Budget vs cost, in one chip. Over is red, under is green, no budget is quiet.
 *
 * **Both figures are ex-VAT.** `budget_amount` matches `line_net`, so the
 * comparison is net against net. That is stated in the chip's `title` and
 * again next to every table this appears in, because getting it wrong reports
 * a 20% overrun on a task that is exactly on budget — the double-VAT mistake
 * this codebase has already made once, in a different place.
 *
 * A task with no budget shows the cost and says so, rather than showing a
 * percentage against zero. "+∞%" and "+100%" are both lies about a task nobody
 * has budgeted yet.
 */
export function VarianceChip({
  row,
  className = "",
}: {
  row: Pick<TaskCostRow, "budget" | "net" | "variance" | "variance_pct">;
  className?: string;
}) {
  if (row.budget <= 0)
    return (
      <span
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-100
          px-2.5 py-1 text-2xs font-semibold text-gray-500 ring-1 ring-inset ring-gray-500/15 ${className}`}
        title="No budget set for this task, so there is nothing to compare against"
      >
        No budget
      </span>
    );

  const over = row.variance > 0.005;
  const under = row.variance < -0.005;
  const pct = row.variance_pct ?? 0;

  return (
    <span
      className={`tnum inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1
        text-2xs font-semibold ring-1 ring-inset ${
          over
            ? "bg-red-50 text-red-700 ring-red-600/15"
            : under
              ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
              : "bg-gray-100 text-gray-600 ring-gray-500/15"
        } ${className}`}
      title={`Budget ${formatCurrency(row.budget)} vs cost ${formatCurrency(
        row.net
      )} — both ex VAT`}
    >
      {over ? "+" : under ? "−" : ""}
      {formatCurrency(Math.abs(row.variance))}
      {over || under ? (
        <span className="opacity-70">
          {pct > 0 ? "+" : ""}
          {Math.round(pct)}%
        </span>
      ) : (
        "on budget"
      )}
    </span>
  );
}

/**
 * "£X on N lines not tagged to a task."
 *
 * The counter to the one way this whole feature quietly produces a wrong
 * answer: a project can read as perfectly on budget because half its spend is
 * invisible to the per-task roll-up. So the figure appears beside every screen
 * that reports per task, not tucked away — and it is a button, because being
 * told about untagged money without being shown which money is not much help.
 */
export function UntaggedNote({
  rollup,
  onShow,
  className = "",
}: {
  rollup: ProjectCostRollup;
  onShow?: () => void;
  className?: string;
}) {
  if (rollup.untagged_line_count === 0) return null;

  const body = (
    <>
      <span className="tnum font-bold">
        {formatCurrency(rollup.untagged_net)}
      </span>{" "}
      on {rollup.untagged_line_count}{" "}
      {rollup.untagged_line_count === 1 ? "line" : "lines"} not tagged to a task
      {onShow ? " — show them" : ""}
    </>
  );

  const classes = `flex w-full items-center gap-2 rounded-2xl bg-amber-50 px-4 py-3
    text-left text-[0.8125rem] leading-snug text-amber-900
    ring-1 ring-inset ring-amber-600/20 ${className}`;

  if (!onShow) return <p className={classes}>{body}</p>;
  return (
    <button type="button" onClick={onShow} className={`${classes} active:bg-amber-100`}>
      {body}
    </button>
  );
}

/** Roll-up variance for a phase row, reusing the task chip's rules exactly. */
export function PhaseVarianceChip({ row }: { row: PhaseCostRow }) {
  return <VarianceChip row={row} />;
}
