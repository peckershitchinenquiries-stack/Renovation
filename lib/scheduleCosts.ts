/**
 * Cost tied to the schedule — the spec's stated must-have.
 *
 * Pure derivation over the tagged lines. Nothing here is stored: a task's
 * actual cost is the sum of the invoice lines and hand-entered costs tagged to
 * it, recomputed on every read, exactly as `computeEntry` and `computePurchase`
 * do for a document.
 *
 * ---------------------------------------------------------------------------
 * Four rules, all inherited, all easy to get wrong
 * ---------------------------------------------------------------------------
 *
 * 1. **The budget is EX-VAT.** `tasks.budget_amount` matches `line_net` and
 *    `expense_entries.actual_amount`, both of which are ex-VAT. So `variance`
 *    is `net − budget`, never `gross − budget`. Comparing a budget against an
 *    incl-VAT cost repeats the double-VAT error of 2026-08-06 in a new place
 *    and reports a 20% overrun on a task that is exactly on budget. Every
 *    screen showing these figures says which basis it is on.
 *
 * 2. **Line level is authoritative.** A task's cost is the sum of the LINES
 *    tagged to it (migration 0017). Documents are never tagged as well, because
 *    two places to sum from means one of them eventually double-counts.
 *
 * 3. **Cancelled is excluded**, the same way `ACTIVE_PURCHASE` and `ACTIVE`
 *    exclude it everywhere else.
 *
 * 4. **The untagged bucket is a feature, not a gap.** Every screen that reports
 *    per task also reports "£X on N lines not tagged to a task". Without it a
 *    project looks perfectly on budget because half its spend is invisible to
 *    the roll-up — which is the single most likely way this whole feature
 *    produces a comforting, wrong answer.
 *
 * ---------------------------------------------------------------------------
 * The one apportionment, and why it is honest
 * ---------------------------------------------------------------------------
 * Payment is recorded per DOCUMENT, never per line (about.md §6) — a line
 * genuinely cannot say what *it* cost you. So `paid` and `committed` at task
 * level are apportioned pro rata by the line's share of its document's gross.
 * That is an estimate and it is labelled as one on screen. The alternative —
 * reporting a task's paid figure as zero until the whole invoice is settled —
 * would be precisely wrong rather than approximately right.
 *
 * `net`, `gross` and `line_count` are NOT apportioned. They are exact.
 */

import { round2 } from "@/lib/purchases";
import type {
  CostImpact,
  ExpenseEntryComputed,
  InvoiceLineView,
  PhaseCostRow,
  ProjectCostRollup,
  ProjectPhase,
  PurchaseComputed,
  Task,
  TaskCostRow,
  TradeLookup,
} from "@/types";

const UNPHASED = "Unphased";

/** The bucket everything untagged lands in — one label, used on every screen. */
export const UNTAGGED_LABEL = "Not tagged to a task";

interface Accumulator {
  budget: number;
  committed: number;
  net: number;
  gross: number;
  paid: number;
  line_count: number;
}

const zero = (): Accumulator => ({
  budget: 0,
  committed: 0,
  net: 0,
  gross: 0,
  paid: 0,
  line_count: 0,
});

/**
 * What share of its document one line represents, by gross.
 *
 * Used only for the two figures that live on the header — paid and committed.
 * A document with no gross at all (a zero-value credit, say) apportions
 * nothing rather than dividing by zero.
 */
function documentShare(line: InvoiceLineView, purchase: PurchaseComputed | undefined): number {
  if (!purchase) return 0;
  const total = Number(purchase.gross_total) || 0;
  if (total <= 0) return 0;
  return line.line_gross / total;
}

function finish(
  acc: Accumulator
): Omit<TaskCostRow, "task_id" | "task_name" | "phase_id"> {
  const variance = round2(acc.net - acc.budget);
  return {
    budget: round2(acc.budget),
    committed: round2(acc.committed),
    net: round2(acc.net),
    gross: round2(acc.gross),
    paid: round2(acc.paid),
    owed: round2(acc.gross - acc.paid),
    variance,
    // No budget means no percentage. Showing "+∞%" or "+100%" against a budget
    // of nothing would read as an overrun on a task nobody has budgeted yet.
    variance_pct: acc.budget > 0 ? round2((variance / acc.budget) * 100) : null,
    line_count: acc.line_count,
  };
}

/**
 * Budget vs committed vs cost vs paid, per task.
 *
 * `entries` are the hand-entered costs (expense_entries), which carry their own
 * `task_id` and their own paid figure — no apportionment needed for those,
 * because a flat expense row IS its own document.
 */
export function taskCostRows(
  tasks: Task[],
  lines: InvoiceLineView[],
  purchases: PurchaseComputed[],
  entries: ExpenseEntryComputed[] = []
): TaskCostRow[] {
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  const acc = new Map<string, Accumulator>();
  for (const task of tasks) {
    const a = zero();
    a.budget = Number(task.budget_amount ?? 0);
    acc.set(task.id, a);
  }

  for (const line of lines) {
    if (!line.task_id) continue;
    if (line.entry_status === "Cancelled") continue;
    const a = acc.get(line.task_id);
    // A line tagged to a task from another project, or to one just deleted.
    // Skipped rather than invented: it will show in the untagged figure.
    if (!a) continue;
    const purchase = purchaseById.get(line.purchase_id);
    const share = documentShare(line, purchase);
    a.net += line.line_net;
    a.gross += line.line_gross;
    a.paid += (purchase?.paid ?? 0) * share;
    a.committed += Number(purchase?.quoted_gross ?? 0) * share;
    a.line_count += 1;
  }

  for (const entry of entries) {
    if (!entry.task_id) continue;
    if (entry.status === "Cancelled") continue;
    // 'invoice' rows are synthetic views of a purchase that the loop above has
    // already counted — adding them here would double every invoiced figure.
    if (entry.source === "invoice") continue;
    const a = acc.get(entry.task_id);
    if (!a) continue;
    a.net += Number(entry.actual_amount);
    a.gross += entry.total_incl_vat;
    a.paid += Number(entry.paid_amount);
    a.committed += Number(entry.quoted_amount);
    a.line_count += 1;
  }

  return tasks.map((task) => ({
    task_id: task.id,
    task_name: task.name,
    phase_id: task.phase_id,
    ...finish(acc.get(task.id) ?? zero()),
  }));
}

/** The same figures rolled up per phase, with an Unphased group at the end. */
export function phaseCostRows(
  phases: ProjectPhase[],
  tasks: Task[],
  rows: TaskCostRow[]
): PhaseCostRow[] {
  const rowByTask = new Map(rows.map((r) => [r.task_id, r]));
  const groups = new Map<string, { name: string; acc: Accumulator; tasks: number }>();

  const key = (id: string | null) => id ?? "__unphased";
  for (const phase of phases)
    groups.set(key(phase.id), { name: phase.name, acc: zero(), tasks: 0 });

  for (const task of tasks) {
    const k = key(task.phase_id);
    let group = groups.get(k);
    if (!group) {
      group = { name: UNPHASED, acc: zero(), tasks: 0 };
      groups.set(k, group);
    }
    group.tasks += 1;
    const row = rowByTask.get(task.id);
    if (!row) continue;
    group.acc.budget += row.budget;
    group.acc.committed += row.committed;
    group.acc.net += row.net;
    group.acc.gross += row.gross;
    group.acc.paid += row.paid;
    group.acc.line_count += row.line_count;
  }

  const ordered: PhaseCostRow[] = phases.map((phase) => {
    const group = groups.get(key(phase.id))!;
    return {
      phase_id: phase.id,
      phase_name: phase.name,
      task_count: group.tasks,
      ...finish(group.acc),
    };
  });

  const unphased = groups.get("__unphased");
  if (unphased && unphased.tasks > 0)
    ordered.push({
      phase_id: null,
      phase_name: UNPHASED,
      task_count: unphased.tasks,
      ...finish(unphased.acc),
    });

  return ordered;
}

/**
 * The project total — and the untagged figure beside it.
 *
 * Read rule 4 above before removing the untagged half of this. It is the only
 * thing standing between a per-task report and a comforting lie.
 */
export function projectCostRollup(
  tasks: Task[],
  lines: InvoiceLineView[],
  purchases: PurchaseComputed[],
  entries: ExpenseEntryComputed[] = []
): ProjectCostRollup {
  const rows = taskCostRows(tasks, lines, purchases, entries);
  const known = new Set(tasks.map((t) => t.id));

  const acc = zero();
  for (const row of rows) {
    acc.budget += row.budget;
    acc.net += row.net;
    acc.gross += row.gross;
    acc.paid += row.paid;
    acc.line_count += row.line_count;
  }

  let untagged_net = 0;
  let untagged_gross = 0;
  let untagged_line_count = 0;
  for (const line of lines) {
    if (line.entry_status === "Cancelled") continue;
    // A tag pointing at a task that no longer exists is untagged in practice,
    // and saying so is the point — the money has to appear somewhere.
    if (line.task_id && known.has(line.task_id)) continue;
    untagged_net += line.line_net;
    untagged_gross += line.line_gross;
    untagged_line_count += 1;
  }
  for (const entry of entries) {
    if (entry.status === "Cancelled" || entry.source === "invoice") continue;
    if (entry.task_id && known.has(entry.task_id)) continue;
    untagged_net += Number(entry.actual_amount);
    untagged_gross += entry.total_incl_vat;
    untagged_line_count += 1;
  }

  return {
    budget: round2(acc.budget),
    net: round2(acc.net),
    gross: round2(acc.gross),
    paid: round2(acc.paid),
    owed: round2(acc.gross - acc.paid),
    variance: round2(acc.net - acc.budget),
    tagged_line_count: acc.line_count,
    untagged_line_count,
    untagged_net: round2(untagged_net),
    untagged_gross: round2(untagged_gross),
  };
}

// ============================================================
// What a delay costs — Phase 4's inline chip
// ============================================================

/**
 * The cost implication of extending a task by `days`.
 *
 * It claims ONLY what it can evidence, and says which rate it used. Two things
 * can be priced today:
 *
 *   • **Time-based hire** — `tasks.hire_daily_rate`. Scaffold is the spec's own
 *     example and it is the common case: three more days on site is three more
 *     days of scaffold whether anyone is standing on it or not.
 *   • **A waiting trade** — the day rate for the task's trade, taken from
 *     `trade_lookups.default_rate × 8` because that lookup is an HOURLY rate.
 *     Labelled an estimate, because it is one. (Phase 5 replaces this with the
 *     assigned person's real day rate.)
 *
 * When neither exists the result is `unpriced: true` and the chip says
 * "no rate on file — no cost estimate" rather than showing £0. A delay that
 * reads as free is worse than a delay with no number on it: £0 is the figure
 * that gets quoted at a client and then turns out to be invented.
 */
export function costImpactOfShift(
  task: Pick<Task, "trade" | "hire_daily_rate">,
  days: number,
  trades: TradeLookup[] = []
): CostImpact {
  const extra = Math.max(0, Math.round(days));
  const basis: string[] = [];
  let hire_cost = 0;
  let labour_cost = 0;

  if (extra === 0)
    return { days: 0, hire_cost: 0, labour_cost: 0, total: 0, basis: [], unpriced: false };

  const hireRate = Number(task.hire_daily_rate ?? 0);
  if (hireRate > 0) {
    hire_cost = round2(hireRate * extra);
    basis.push(`hire £${hireRate.toFixed(2)}/day × ${extra}`);
  }

  const trade = task.trade
    ? trades.find((t) => t.name.toLowerCase() === task.trade!.toLowerCase())
    : undefined;
  const hourly = Number(trade?.default_rate ?? 0);
  if (hourly > 0) {
    // The lookup is per hour; a day on a domestic site is eight of them.
    const daily = round2(hourly * 8);
    labour_cost = round2(daily * extra);
    basis.push(`${trade!.name} £${daily.toFixed(2)}/day × ${extra} (estimate)`);
  }

  const total = round2(hire_cost + labour_cost);
  return {
    days: extra,
    hire_cost,
    labour_cost,
    total,
    basis,
    unpriced: basis.length === 0,
  };
}
