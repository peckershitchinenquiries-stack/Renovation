/**
 * Portfolio reporting — the spec's §6 dashboard.
 *
 * "% complete, days behind/ahead and budget variance, across all live projects
 * at once." Every figure here is derived from Phases 1–3; this file adds no
 * schema and stores nothing.
 *
 * ---------------------------------------------------------------------------
 * There are TWO percentages, and both are always named
 * ---------------------------------------------------------------------------
 * `pct_complete` is the duration-weighted mean of hand-entered task progress.
 * `pct_cost` is spend against budget. They answer different questions and they
 * disagree constantly — a job is routinely 40% built and 70% spent, which is
 * the single most useful thing this screen can tell anyone.
 *
 * Deriving progress FROM spend, which is the tempting shortcut, reports 90%
 * done the day a large material order lands. So both are computed, both are
 * labelled, and neither is ever shown as "the" percentage.
 *
 * ---------------------------------------------------------------------------
 * "Days behind" says what it measured against
 * ---------------------------------------------------------------------------
 * Against the captured baseline where one exists; against
 * `projects.planned_end_date` where it does not; and null when there is
 * neither, rather than zero. `variance_basis` carries which, so the screen can
 * print "7 days behind baseline" or "7 days behind target" and never leave the
 * reader guessing which promise is being broken.
 */

import { calendarDaysBetween, isISODate, scheduleProject, taskProgressRollup } from "@/lib/schedule";
import { projectCostRollup } from "@/lib/scheduleCosts";
import type {
  ExpenseEntryComputed,
  InvoiceLineView,
  ProjectHealth,
  PurchaseComputed,
  ScheduleBundle,
  ScheduleResult,
} from "@/types";

export interface PortfolioInput {
  bundle: ScheduleBundle;
  lines: InvoiceLineView[];
  purchases: PurchaseComputed[];
  entries: ExpenseEntryComputed[];
}

/**
 * How one project is doing, on both axes.
 *
 * Takes an already-computed `ScheduleResult` when the caller has one — the
 * project page has scheduled the tasks already and running the forward and
 * backward passes a second time would be waste.
 */
export function projectHealth(
  input: PortfolioInput,
  precomputed?: ScheduleResult
): ProjectHealth {
  const { bundle, lines, purchases, entries } = input;
  const project = bundle.project;
  const schedule = precomputed ?? scheduleProject(bundle);
  const rollup = projectCostRollup(bundle.tasks, lines, purchases, entries);

  // The budget compared against is the PROJECT target where one is set, because
  // that is the number the dashboard has always shown and the one the owner
  // recognises. Per-task budgets roll up separately on the Schedule tab.
  const budget = Number(project.target_budget) || 0;
  // Gross, to match the dashboard's existing "Cost to date" — that figure is
  // incl-VAT everywhere and this card sits beside it. The ex-VAT comparison
  // lives on the Schedule tab, against per-task budgets, where the basis is
  // stated. Mixing them here would make two adjacent cards disagree.
  const cost = rollup.gross;

  // Days behind, and against what.
  let days_variance: number | null = null;
  let variance_basis: ProjectHealth["variance_basis"] = "none";
  if (schedule.completion && isISODate(schedule.baseline_completion)) {
    days_variance = calendarDaysBetween(
      schedule.baseline_completion,
      schedule.completion
    );
    variance_basis = "baseline";
  } else if (schedule.completion && isISODate(project.planned_end_date)) {
    days_variance = calendarDaysBetween(
      project.planned_end_date,
      schedule.completion
    );
    variance_basis = "planned_end_date";
  }

  const live = bundle.tasks.filter((t) => t.status !== "Cancelled");

  return {
    project_id: project.id,
    project_name: project.name,
    status: project.status,
    pct_complete: taskProgressRollup(bundle.tasks, bundle.calendar),
    pct_cost: budget > 0 ? Math.round((cost / budget) * 1000) / 10 : null,
    days_variance,
    variance_basis,
    completion: schedule.completion,
    budget,
    cost,
    budget_variance: Math.round((cost - budget) * 100) / 100,
    task_count: live.length,
    critical_count: schedule.critical_task_ids.length,
    order_soon_count: countOrderSoon(schedule),
  };
}

function countOrderSoon(schedule: ScheduleResult, withinDays = 14): number {
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  for (const task of schedule.tasks) {
    if (task.status === "Complete" || task.status === "Cancelled") continue;
    if (!task.lead_time_days || task.lead_time_days <= 0) continue;
    if (!isISODate(task.computed_start)) continue;
    const orderBy = calendarDaysBetween(
      today,
      new Date(
        Date.parse(`${task.computed_start}T00:00:00Z`) -
          task.lead_time_days * 86_400_000
      )
        .toISOString()
        .slice(0, 10)
    );
    if (orderBy <= withinDays) count += 1;
  }
  return count;
}

/**
 * The portfolio line: how many sites are behind, and by how much overall.
 *
 * Deliberately NOT a sum of the percentages — averaging "60% complete" across
 * a £400k job and a £4k job produces a number that describes neither. The
 * money is summed because money sums; the schedule is reported as a count of
 * projects behind, which is the question actually being asked.
 */
export function portfolioRollup(healths: ProjectHealth[]): {
  projects: number;
  active: number;
  behind: number;
  worst_days: number | null;
  budget: number;
  cost: number;
  variance: number;
  order_soon: number;
} {
  const active = healths.filter((h) => h.status === "active");
  const behind = healths.filter((h) => (h.days_variance ?? 0) > 0);
  const worst = behind
    .map((h) => h.days_variance ?? 0)
    .sort((a, b) => b - a)[0];

  const budget = healths.reduce((s, h) => s + h.budget, 0);
  const cost = healths.reduce((s, h) => s + h.cost, 0);

  return {
    projects: healths.length,
    active: active.length,
    behind: behind.length,
    worst_days: worst ?? null,
    budget: Math.round(budget * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    variance: Math.round((cost - budget) * 100) / 100,
    order_soon: healths.reduce((s, h) => s + h.order_soon_count, 0),
  };
}

/**
 * Red / amber / green for a schedule chip.
 *
 * A week is the threshold because a domestic renovation absorbs a couple of
 * days without anyone noticing, and does not absorb a fortnight.
 */
export function scheduleTone(
  days: number | null
): "good" | "warn" | "bad" | "neutral" {
  if (days === null) return "neutral";
  if (days <= 0) return "good";
  if (days <= 7) return "warn";
  return "bad";
}

/** "7 days behind baseline" / "on schedule" / "3 days ahead of target". */
export function scheduleLabel(health: {
  days_variance: number | null;
  variance_basis: ProjectHealth["variance_basis"];
}): string {
  if (health.days_variance === null) return "No target set";
  const against =
    health.variance_basis === "baseline" ? "baseline" : "target";
  const days = health.days_variance;
  if (days === 0) return `On ${against}`;
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days > 0
    ? `${n} ${unit} behind ${against}`
    : `${n} ${unit} ahead of ${against}`;
}
