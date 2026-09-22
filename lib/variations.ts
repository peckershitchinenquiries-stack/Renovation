/**
 * Variations — what changed, why, and what it did to the money and the dates.
 *
 * The table is small and its value is entirely in being linked. A variation on
 * its own is a note; a variation that shows what the task it names has ACTUALLY
 * cost since, and how far that task has drifted, is evidence.
 *
 * ---------------------------------------------------------------------------
 * Two numbers, never one
 * ---------------------------------------------------------------------------
 * `cost_impact` is what was AGREED — typed in, at the time, by the person who
 * agreed it. `task_actual_net` is what the linked task has since been invoiced.
 * They are shown side by side and are never combined, because the whole reason
 * anyone opens a variations log six months later is to find out whether those
 * two figures matched. Collapsing them into a single "variation cost" throws
 * away the only question the screen answers.
 *
 * Both impacts are SIGNED. Taking the second bathroom out of the scope is a
 * variation worth −£6,000 and −5 days; a roll-up that can only add would
 * report the job as more expensive than it is.
 */

import { round2 } from "@/lib/purchases";
import type {
  ScheduledTask,
  TaskCostRow,
  Variation,
  VariationRollup,
  VariationView,
} from "@/types";

/** Attach the linked task's real cost and real drift to each variation. */
export function variationViews(
  variations: Variation[],
  taskCosts: TaskCostRow[],
  scheduled: ScheduledTask[],
  phaseNames: Map<string, string>
): VariationView[] {
  const costByTask = new Map(taskCosts.map((r) => [r.task_id, r]));
  const taskById = new Map(scheduled.map((t) => [t.id, t]));

  return variations
    .map((v): VariationView => {
      const task = v.task_id ? taskById.get(v.task_id) ?? null : null;
      const cost = v.task_id ? costByTask.get(v.task_id) ?? null : null;
      return {
        ...v,
        task_name: task?.name ?? null,
        phase_name: v.phase_id ? phaseNames.get(v.phase_id) ?? null : null,
        // Ex-VAT, to match `budget_amount` and `line_net`. A variation agreed
        // at £4,000 is compared against £4,000 of net cost, never against the
        // incl-VAT figure — that is the double-VAT error this codebase has
        // already made once (about.md §17).
        task_actual_net: cost ? cost.net : null,
        task_drift_days: task?.drift_end_days ?? null,
      };
    })
    .sort((a, b) => {
      // Newest first, and within a day, by reference so "VO 7" follows "VO 6".
      const byDate = b.raised_on.localeCompare(a.raised_on);
      if (byDate !== 0) return byDate;
      return (a.ref ?? "").localeCompare(b.ref ?? "", undefined, {
        numeric: true,
      });
    });
}

/**
 * The project's variation position.
 *
 * Approved and proposed are counted separately and never added. An approved
 * variation is a commitment; a proposed one is a conversation, and a figure
 * that quietly includes conversations is how a forecast becomes fiction.
 * Rejected and withdrawn contribute to neither — they are kept as a record
 * that the question was asked and answered.
 */
export function variationRollup(variations: Variation[]): VariationRollup {
  const rollup: VariationRollup = {
    approved_cost: 0,
    approved_days: 0,
    proposed_cost: 0,
    proposed_days: 0,
    approved_count: 0,
    proposed_count: 0,
  };

  for (const v of variations) {
    const cost = Number(v.cost_impact ?? 0);
    const days = Number(v.days_impact ?? 0);
    if (v.status === "approved") {
      rollup.approved_cost += Number.isFinite(cost) ? cost : 0;
      rollup.approved_days += Number.isFinite(days) ? days : 0;
      rollup.approved_count += 1;
    } else if (v.status === "proposed") {
      rollup.proposed_cost += Number.isFinite(cost) ? cost : 0;
      rollup.proposed_days += Number.isFinite(days) ? days : 0;
      rollup.proposed_count += 1;
    }
  }

  rollup.approved_cost = round2(rollup.approved_cost);
  rollup.proposed_cost = round2(rollup.proposed_cost);
  return rollup;
}

/**
 * One sentence for the Overview, in the style of the existing invoice sentence.
 *
 * Returns null when there are no variations, so the screen shows nothing at all
 * rather than "£0 of variations" — which reads as a claim that none were needed
 * rather than as a claim that none were recorded.
 *
 * It says **ex VAT**, because it has to. `cost_impact` matches `budget_amount`
 * and `line_net` (rule 7 of about.md §2), and the figures it sits next to on
 * the Overview are incl VAT. A number whose basis is not on screen beside it
 * is how the double-VAT error of 2026-08-06 happened.
 *
 * Signs are explicit for the same reason: an omission is a negative variation —
 * taking the second bathroom out of the scope is worth −£6,000 — and "worth
 * £6,000" would read as the opposite of what happened.
 */
export function variationSentence(
  rollup: VariationRollup,
  formatCurrency: (n: number) => string
): string | null {
  if (rollup.approved_count === 0 && rollup.proposed_count === 0) return null;

  const signed = (n: number) => `${n > 0 ? "+" : ""}${formatCurrency(n)}`;

  const parts: string[] = [];
  if (rollup.approved_count > 0) {
    const days =
      rollup.approved_days === 0
        ? ""
        : ` and ${rollup.approved_days > 0 ? "+" : ""}${rollup.approved_days} days`;
    parts.push(
      `${rollup.approved_count} approved ${
        rollup.approved_count === 1 ? "variation" : "variations"
      } worth ${signed(rollup.approved_cost)} ex VAT${days}`
    );
  }
  if (rollup.proposed_count > 0)
    parts.push(
      `${rollup.proposed_count} still proposed (${signed(
        rollup.proposed_cost
      )} ex VAT, not committed)`
    );
  return `${parts.join("; ")}.`;
}

/**
 * The budget with the variations that were actually AGREED added to it.
 *
 * `projects.target_budget` is the figure somebody typed when the job was set
 * up. A £12,000 variation approved in month four does not change that number,
 * and nothing was writing it anywhere else — so the project read as £12,000
 * over budget with nothing on any screen saying why. This is the derived
 * answer; the stored one is left exactly as it was typed, because a target
 * that silently moves is not a target.
 *
 * Three things it deliberately does NOT do:
 *
 *   • **It does not include proposed variations.** An approved variation is a
 *     commitment; a proposed one is a conversation, and a budget that quietly
 *     includes conversations is a forecast that is fiction. The proposed
 *     figure is reported beside this one, never inside it.
 *   • **It does not assume variations only add.** `approved_cost` is signed,
 *     so an omission subtracts, which is the whole reason the column is
 *     signed.
 *   • **It does not convert anything.** `cost_impact` is ex VAT and
 *     `target_budget` has VAT in it wherever the person setting it put VAT in
 *     it. Inventing a rate to gross the variation up would be a guess dressed
 *     as arithmetic — so the agreed figure is added AS AGREED, and every
 *     screen showing this says on which basis each half is. That is the
 *     honest option, not a tidy one.
 */
export function budgetWithApprovedVariations(
  targetBudget: number,
  rollup: VariationRollup | null
): number {
  const budget = Number(targetBudget) || 0;
  if (!rollup) return round2(budget);
  const approved = Number(rollup.approved_cost);
  return round2(budget + (Number.isFinite(approved) ? approved : 0));
}

/**
 * Where the agreement and the reality have parted company.
 *
 * A variation is flagged when the linked task's actual net cost has exceeded
 * the agreed impact by more than the tolerance. It is a prompt to look, not a
 * verdict: the task's cost includes everything tagged to it, not only the
 * variation's share, so a task that was always going to cost something will
 * naturally exceed a small variation. The screen says so.
 */
export const VARIATION_DRIFT_TOLERANCE = 0.01;

export function variationsOverAgreement(
  views: VariationView[]
): VariationView[] {
  return views.filter(
    (v) =>
      v.status === "approved" &&
      v.cost_impact !== null &&
      v.cost_impact > 0 &&
      v.task_actual_net !== null &&
      v.task_actual_net > v.cost_impact + VARIATION_DRIFT_TOLERANCE
  );
}
