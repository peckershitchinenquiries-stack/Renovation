/**
 * The scheduling engine.
 *
 * Pure functions: no I/O, no React, no Supabase, nothing async. Everything a
 * Gantt chart, a critical-path badge, a float column or a "what if" simulation
 * needs is computed here, from a bundle of rows, and none of it is ever
 * stored — the same rule `lib/calculations.ts` and `lib/purchases.ts` follow
 * for money (about.md §2).
 *
 * That purity is not an aesthetic choice. It is what makes Phase 9's scenario
 * mode nearly free: a "what if" is this same function run over a modified copy
 * of the bundle that is never saved.
 *
 * ---------------------------------------------------------------------------
 * The four rules this file implements
 * ---------------------------------------------------------------------------
 *
 * 1. **Duration is authoritative.** A task's length is `duration_days`; its
 *    dates are derived from that plus its dependency constraints. Where a task
 *    has no predecessors, `planned_start` is the anchor.
 *
 * 2. **`planned_start` is a "start no earlier than" constraint, always.**
 *    Even on a task with predecessors. This is what makes a manual shift stick
 *    — you drag a bar right, the date is written, and the engine will not pull
 *    it back — while still letting a predecessor's slip push it further right.
 *    It is the standard constraint every real scheduler calls SNET, and it is
 *    the one thing to understand before reading `forwardPass`.
 *
 * 3. **Float is in WORKING days; drift and LAG are in CALENDAR days.** They are
 *    read by different people for different reasons. Float answers "how many
 *    days on site could I lose here" — a weekend is not one of them. Drift
 *    answers "how late are we" — and a builder who is a week late is seven days
 *    late, not five. Lag answers "how long must we wait" — and screed dries at
 *    the weekend too, which is why a 7-day lag means a week, not nine days.
 *    All three are labelled on screen. See `addLag` below.
 *
 * 4. **Cycles are refused, not survived.** Postgres cannot express "this graph
 *    is acyclic" cheaply, so nothing in the database guards it. `detectCycle`
 *    does, the API route returns a 400 naming the loop, and `scheduleProject`
 *    returns `cycle` populated and every task undated rather than looping for
 *    ever.
 */

import type {
  ScheduleBundle,
  ScheduleResult,
  ScheduledTask,
  Task,
  TaskBaseline,
  TaskDependency,
  TaskSignoff,
  WorkCalendar,
} from "@/types";

/**
 * Five days a week, no holidays.
 *
 * This lives here rather than in `types/index.ts` because it is the only
 * RUNTIME value this module needs, and lib/schedule.test.mts runs under
 * `node --experimental-strip-types`, which erases type-only imports but cannot
 * resolve the `@/` path alias for a real one. Keeping it beside the engine is
 * what keeps the engine testable at all.
 */
export const DEFAULT_WORK_CALENDAR: WorkCalendar = {
  working_weekdays: [1, 2, 3, 4, 5],
  holidays: [],
};

// ============================================================
// Dates — ISO strings in, ISO strings out, no Date objects escape
// ============================================================
// Every date in this app is a bare 'YYYY-MM-DD' off an invoice or a plan, not
// an instant. `new Date("2026-03-01")` parses as UTC midnight and then renders
// in local time, which turns 1 March into 28 February for anyone west of
// Greenwich — the bug components/project/format.ts already documents. So all
// arithmetic here is done in whole UTC days and never touches local time.

const MS_PER_DAY = 86_400_000;

/** Guards every loop that walks a calendar, so a bad input cannot hang a page. */
const MAX_DAY_WALK = 5_000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value);
}

/** Days since the epoch. The integer every calculation below actually uses. */
export function toDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

export function fromDayNumber(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday, matching the database's `working_weekdays`. */
export function isoWeekday(iso: string): number {
  const jsDay = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return jsDay === 0 ? 7 : jsDay;
}

/** Calendar days from `a` to `b`, signed. Negative when `b` is earlier. */
export function calendarDaysBetween(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function addCalendarDays(iso: string, days: number): string {
  return fromDayNumber(toDayNumber(iso) + days);
}

/** Today, as the same kind of bare UTC date every stored date is. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

// ============================================================
// The working calendar
// ============================================================

interface CalendarIndex {
  weekdays: Set<number>;
  holidays: Set<string>;
}

function indexCalendar(calendar?: WorkCalendar | null): CalendarIndex {
  const cal = calendar ?? DEFAULT_WORK_CALENDAR;
  const weekdays = new Set(
    (cal.working_weekdays?.length ? cal.working_weekdays : [1, 2, 3, 4, 5]).map(
      Number
    )
  );
  return { weekdays, holidays: new Set(cal.holidays ?? []) };
}

export function isWorkingDay(iso: string, calendar?: WorkCalendar | null): boolean {
  const idx = indexCalendar(calendar);
  return idx.weekdays.has(isoWeekday(iso)) && !idx.holidays.has(iso);
}

/**
 * The first working day on or after `iso` (or on or before, going backwards).
 *
 * Used everywhere a date arrives from a human: a task typed as starting on a
 * Sunday starts on the Monday, rather than silently having one day of its
 * duration eaten.
 */
export function snapToWorkingDay(
  iso: string,
  calendar?: WorkCalendar | null,
  direction: 1 | -1 = 1
): string {
  const idx = indexCalendar(calendar);
  let day = toDayNumber(iso);
  for (let i = 0; i < MAX_DAY_WALK; i += 1) {
    const candidate = fromDayNumber(day);
    if (idx.weekdays.has(isoWeekday(candidate)) && !idx.holidays.has(candidate))
      return candidate;
    day += direction;
  }
  // Every day is a holiday, or the array was empty and the guard above failed.
  // Returning the input is wrong but bounded; looping for ever is not.
  return iso;
}

/**
 * Move `n` WORKING days from a date. `n = 0` snaps and returns.
 *
 * `shiftWorkingDays(mondayIso, 4)` is the Friday. Negative walks backwards.
 */
export function shiftWorkingDays(
  iso: string,
  n: number,
  calendar?: WorkCalendar | null
): string {
  const idx = indexCalendar(calendar);
  const step = n < 0 ? -1 : 1;
  let current = snapToWorkingDay(iso, calendar, step);
  let remaining = Math.abs(n);
  let guard = 0;
  while (remaining > 0 && guard < MAX_DAY_WALK) {
    guard += 1;
    const next = fromDayNumber(toDayNumber(current) + step);
    current = next;
    if (idx.weekdays.has(isoWeekday(current)) && !idx.holidays.has(current))
      remaining -= 1;
  }
  return current;
}

/**
 * Signed working days you must advance from `a` to reach `b`.
 *
 * Same day → 0. Friday → Monday → 1, because the weekend is not work. This is
 * a *delta*, so an inclusive span (how long a task lasts) is
 * `workingDaysBetween(start, end) + 1` — see `inclusiveWorkingDays`.
 */
export function workingDaysBetween(
  a: string,
  b: string,
  calendar?: WorkCalendar | null
): number {
  if (a === b) return 0;
  const idx = indexCalendar(calendar);
  const forward = toDayNumber(b) > toDayNumber(a);
  const from = forward ? a : b;
  const to = forward ? b : a;
  let count = 0;
  let day = toDayNumber(from);
  const target = toDayNumber(to);
  let guard = 0;
  while (day < target && guard < MAX_DAY_WALK) {
    guard += 1;
    day += 1;
    const iso = fromDayNumber(day);
    if (idx.weekdays.has(isoWeekday(iso)) && !idx.holidays.has(iso)) count += 1;
  }
  return forward ? count : -count;
}

/** How many working days a span covers, counting both ends. */
export function inclusiveWorkingDays(
  start: string,
  end: string,
  calendar?: WorkCalendar | null
): number {
  return Math.max(1, workingDaysBetween(start, end, calendar) + 1);
}

/** Where a task of `duration` working days starting on `start` finishes. */
export function endFromDuration(
  start: string,
  duration: number,
  calendar?: WorkCalendar | null
): string {
  return shiftWorkingDays(start, Math.max(1, Math.round(duration)) - 1, calendar);
}

/** Where a task of `duration` working days finishing on `end` must start. */
export function startFromDuration(
  end: string,
  duration: number,
  calendar?: WorkCalendar | null
): string {
  return shiftWorkingDays(end, -(Math.max(1, Math.round(duration)) - 1), calendar);
}

/**
 * Apply a dependency lag — in CALENDAR days — and land on a working day.
 *
 * Rule 3. A lag is a WAIT, not work: screed dries over the weekend, concrete
 * cures over a bank holiday, and a merchant's quoted week is seven days. Before
 * this was fixed the lag was walked in working days, so the commonest lag on a
 * domestic site — "leave it seven days" — silently became nine. It is the same
 * unit `orderByDate` already uses for lead times, and now the two agree.
 *
 * `direction` is which way to snap once the wait is over: forward for a
 * constraint that pushes a task later (the forward pass), backwards for one
 * that pulls a deadline earlier (the backward pass).
 */
export function addLag(
  iso: string,
  lagDays: number,
  calendar?: WorkCalendar | null,
  direction: 1 | -1 = 1
): string {
  return snapToWorkingDay(
    addCalendarDays(iso, Math.round(lagDays)),
    calendar,
    direction
  );
}

/**
 * The duration implied by a pair of typed dates, or `undefined`.
 *
 * Exists because `duration_days` is authoritative (rule 1), which means a
 * screen that lets somebody type an END date has to convert it into a duration
 * or the edit does nothing at all. Both the shift route and the scenario
 * preview call this, so a dragged bar, a typed date and the saved row can
 * never disagree about how long the task now is.
 */
export function durationFromDates(
  start: string | null | undefined,
  end: string | null | undefined,
  calendar?: WorkCalendar | null
): number | undefined {
  if (!isISODate(start) || !isISODate(end)) return undefined;
  if (toDayNumber(end) < toDayNumber(start)) return undefined;
  return inclusiveWorkingDays(start, end, calendar);
}

// ============================================================
// Small derivations — the whole of what Phase 1 needed
// ============================================================

/**
 * How long a task is, in working days.
 *
 * `duration_days` wins because it is authoritative (rule 1). Two planned dates
 * with no duration are measured; a lone start is one day; a task with nothing
 * at all is one day, so that a sketched-out task still draws a bar.
 */
export function taskDurationDays(
  task: Pick<Task, "duration_days" | "planned_start" | "planned_end">,
  calendar?: WorkCalendar | null
): number {
  if (task.duration_days && task.duration_days > 0)
    return Math.round(task.duration_days);
  if (task.planned_start && task.planned_end)
    return inclusiveWorkingDays(task.planned_start, task.planned_end, calendar);
  return 1;
}

/**
 * A phase's ACTUAL dates: earliest actual start, latest actual end, over its
 * tasks. Derived, never stored — storing it would be storing a computed total.
 * `end` stays null until every started task has finished, because a phase with
 * work still open has not ended.
 */
export function phaseActualDates(tasks: Task[]): {
  start: string | null;
  end: string | null;
} {
  const starts = tasks.map((t) => t.actual_start).filter(isISODate);
  const ends = tasks.map((t) => t.actual_end).filter(isISODate);
  const anyUnfinished = tasks.some((t) => t.actual_start && !t.actual_end);
  return {
    start: starts.length ? starts.slice().sort()[0] : null,
    end: anyUnfinished || !ends.length ? null : ends.slice().sort().reverse()[0],
  };
}

/**
 * Project % complete: the duration-weighted mean of hand-entered task
 * progress. Weighted by duration because a three-week task at 50% is worth
 * more than a one-day task at 100%, and an unweighted mean says otherwise.
 *
 * Cancelled tasks are excluded — they are not work that remains to be done.
 */
export function taskProgressRollup(
  tasks: Task[],
  calendar?: WorkCalendar | null
): number {
  const live = tasks.filter((t) => t.status !== "Cancelled");
  if (live.length === 0) return 0;
  let weighted = 0;
  let total = 0;
  for (const t of live) {
    const w = taskDurationDays(t, calendar);
    weighted += w * Number(t.progress_pct ?? 0);
    total += w;
  }
  return total > 0 ? Math.round((weighted / total) * 10) / 10 : 0;
}

// ============================================================
// The dependency graph
// ============================================================

interface Graph {
  successors: Map<string, TaskDependency[]>;
  predecessors: Map<string, TaskDependency[]>;
}

function buildGraph(tasks: Task[], deps: TaskDependency[]): Graph {
  const ids = new Set(tasks.map((t) => t.id));
  const successors = new Map<string, TaskDependency[]>();
  const predecessors = new Map<string, TaskDependency[]>();
  for (const t of tasks) {
    successors.set(t.id, []);
    predecessors.set(t.id, []);
  }
  for (const d of deps) {
    // A dependency naming a task that is not in this bundle is stale — a task
    // deleted in another tab, most likely. Skipping it is right: the alternative
    // is an undated schedule because of a row nobody can see.
    if (!ids.has(d.predecessor_id) || !ids.has(d.successor_id)) continue;
    successors.get(d.predecessor_id)!.push(d);
    predecessors.get(d.successor_id)!.push(d);
  }
  return { successors, predecessors };
}

/**
 * Find a dependency loop, if there is one.
 *
 * Returns the task ids that form the cycle (first id repeated at the end), or
 * null. Iterative DFS with an explicit stack rather than recursion: a deep
 * chain of tasks should not be able to blow the stack in a route handler.
 */
export function detectCycle(
  tasks: Task[],
  deps: TaskDependency[]
): string[] | null {
  const { successors } = buildGraph(tasks, deps);
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const colour = new Map<string, number>();
  for (const t of tasks) colour.set(t.id, WHITE);

  for (const root of tasks) {
    if (colour.get(root.id) !== WHITE) continue;
    // Each frame is [node, index of the next successor to explore].
    const stack: { id: string; next: number }[] = [{ id: root.id, next: 0 }];
    const path: string[] = [root.id];
    colour.set(root.id, GREY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edges = successors.get(frame.id) ?? [];
      if (frame.next >= edges.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        path.pop();
        continue;
      }
      const next = edges[frame.next].successor_id;
      frame.next += 1;
      const seen = colour.get(next);
      if (seen === GREY) {
        // Back edge: the loop is the tail of the current path from `next`.
        const from = path.indexOf(next);
        return [...path.slice(from), next];
      }
      if (seen === WHITE) {
        colour.set(next, GREY);
        stack.push({ id: next, next: 0 });
        path.push(next);
      }
    }
  }
  return null;
}

/**
 * Execution order — every task after all of its predecessors.
 *
 * Kahn's algorithm. Ties break on `sort_order` then name, so a schedule with no
 * dependencies at all still comes back in the order the user arranged it rather
 * than in whatever order the rows arrived.
 */
export function topoSort(tasks: Task[], deps: TaskDependency[]): Task[] {
  const { successors, predecessors } = buildGraph(tasks, deps);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  for (const t of tasks) indegree.set(t.id, (predecessors.get(t.id) ?? []).length);

  const ready = tasks
    .filter((t) => (indegree.get(t.id) ?? 0) === 0)
    .sort(compareTasks);
  const out: Task[] = [];

  while (ready.length > 0) {
    const task = ready.shift()!;
    out.push(task);
    for (const edge of successors.get(task.id) ?? []) {
      const left = (indegree.get(edge.successor_id) ?? 1) - 1;
      indegree.set(edge.successor_id, left);
      if (left === 0) {
        const next = byId.get(edge.successor_id);
        if (next) {
          ready.push(next);
          ready.sort(compareTasks);
        }
      }
    }
  }

  // A cycle leaves rows unemitted. Append them so nothing silently vanishes;
  // the caller has already been told about the cycle by `detectCycle`.
  if (out.length < tasks.length) {
    const emitted = new Set(out.map((t) => t.id));
    out.push(...tasks.filter((t) => !emitted.has(t.id)).sort(compareTasks));
  }
  return out;
}

function compareTasks(a: Task, b: Task): number {
  return (
    (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
    (a.planned_start ?? "9999").localeCompare(b.planned_start ?? "9999") ||
    a.name.localeCompare(b.name)
  );
}

// ============================================================
// Forward and backward passes
// ============================================================

interface PassRow {
  task: Task;
  duration: number;
  early_start: string;
  early_finish: string;
  late_start: string;
  late_finish: string;
}

const laterOf = (a: string | null, b: string) =>
  a === null || toDayNumber(b) > toDayNumber(a) ? b : a;
const earlierOf = (a: string | null, b: string) =>
  a === null || toDayNumber(b) < toDayNumber(a) ? b : a;

/**
 * Earliest possible start and finish for every task.
 *
 * `anchor` is where a task with no constraints at all begins: the project's
 * start date, or today. Read rule 2 in the file header before changing how
 * `planned_start` is treated here — it is a lower bound, not an override.
 */
export function forwardPass(
  ordered: Task[],
  deps: TaskDependency[],
  calendar: WorkCalendar,
  anchor: string
): Map<string, PassRow> {
  const { predecessors } = buildGraph(ordered, deps);
  const rows = new Map<string, PassRow>();

  for (const task of ordered) {
    const duration = taskDurationDays(task, calendar);

    let minStart: string | null = null;
    let minFinish: string | null = null;

    for (const dep of predecessors.get(task.id) ?? []) {
      const pred = rows.get(dep.predecessor_id);
      // Only possible when a cycle left a predecessor unscheduled; the caller
      // has already refused to trust this result.
      if (!pred) continue;
      // Calendar days, per rule 3 — a wait is a wait whether or not anybody is
      // on site for it.
      const lag = Number(dep.lag_days ?? 0);
      switch (dep.dep_type) {
        case "FS":
          // The day AFTER the predecessor finishes, plus the lag. With no lag
          // that is simply the next working day.
          minStart = laterOf(
            minStart,
            addLag(pred.early_finish, 1 + lag, calendar)
          );
          break;
        case "SS":
          minStart = laterOf(minStart, addLag(pred.early_start, lag, calendar));
          break;
        case "FF":
          minFinish = laterOf(
            minFinish,
            addLag(pred.early_finish, lag, calendar)
          );
          break;
        case "SF":
          minFinish = laterOf(minFinish, addLag(pred.early_start, lag, calendar));
          break;
      }
    }

    // Rule 2: a typed start is "no earlier than", whether or not the task has
    // predecessors. This is what makes a manual drag stick.
    if (isISODate(task.planned_start))
      minStart = laterOf(minStart, snapToWorkingDay(task.planned_start, calendar));

    let early_start = snapToWorkingDay(minStart ?? anchor, calendar);
    let early_finish = endFromDuration(early_start, duration, calendar);

    // A finish constraint (FF/SF) can push the task later than its start
    // constraints did; the start then follows from the duration.
    if (minFinish && toDayNumber(minFinish) > toDayNumber(early_finish)) {
      early_finish = snapToWorkingDay(minFinish, calendar);
      early_start = startFromDuration(early_finish, duration, calendar);
    }

    rows.set(task.id, {
      task,
      duration,
      early_start,
      early_finish,
      // Filled by the backward pass; seeded so the type is honest.
      late_start: early_start,
      late_finish: early_finish,
    });
  }

  return rows;
}

/**
 * Latest a task can start and finish without moving the project's completion.
 *
 * Walks the same order backwards. A task with no successors is only bounded by
 * the project finish, which is the latest early finish of anything.
 */
export function backwardPass(
  ordered: Task[],
  deps: TaskDependency[],
  calendar: WorkCalendar,
  rows: Map<string, PassRow>,
  projectFinish: string
): Map<string, PassRow> {
  const { successors } = buildGraph(ordered, deps);

  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const task = ordered[i];
    const row = rows.get(task.id);
    if (!row) continue;

    let maxFinish: string | null = null;
    let maxStart: string | null = null;

    for (const dep of successors.get(task.id) ?? []) {
      const succ = rows.get(dep.successor_id);
      if (!succ) continue;
      // The mirror of the forward pass, and in the same unit: calendar days,
      // snapped BACKWARDS because these are deadlines, not start dates.
      const lag = Number(dep.lag_days ?? 0);
      switch (dep.dep_type) {
        case "FS":
          // Must finish the day before the successor's latest start, less the
          // lag it has to wait through.
          maxFinish = earlierOf(
            maxFinish,
            addLag(succ.late_start, -(1 + lag), calendar, -1)
          );
          break;
        case "SS":
          maxStart = earlierOf(
            maxStart,
            addLag(succ.late_start, -lag, calendar, -1)
          );
          break;
        case "FF":
          maxFinish = earlierOf(
            maxFinish,
            addLag(succ.late_finish, -lag, calendar, -1)
          );
          break;
        case "SF":
          maxStart = earlierOf(
            maxStart,
            addLag(succ.late_finish, -lag, calendar, -1)
          );
          break;
      }
    }

    let late_finish = snapToWorkingDay(maxFinish ?? projectFinish, calendar, -1);
    let late_start = startFromDuration(late_finish, row.duration, calendar);

    if (maxStart && toDayNumber(maxStart) < toDayNumber(late_start)) {
      late_start = snapToWorkingDay(maxStart, calendar, -1);
      late_finish = endFromDuration(late_start, row.duration, calendar);
    }

    row.late_start = late_start;
    row.late_finish = late_finish;
  }

  return rows;
}

// ============================================================
// The one entry point
// ============================================================

/**
 * Schedule a project: dates, float, critical path, blocking and baseline drift.
 *
 * Everything the Schedule tab, the Gantt and the portfolio dashboard read comes
 * out of this one call. It never writes and never mutates its input, which is
 * what lets `applyShift` below preview a change without saving it.
 */
export function scheduleProject(bundle: ScheduleBundle): ScheduleResult {
  const calendar = bundle.calendar ?? DEFAULT_WORK_CALENDAR;
  const tasks = bundle.tasks ?? [];
  const deps = bundle.dependencies ?? [];

  const empty: ScheduleResult = {
    tasks: [],
    completion: null,
    baseline_completion: null,
    completion_drift_days: null,
    critical_task_ids: [],
    cycle: null,
  };
  if (tasks.length === 0) return empty;

  // Refuse rather than loop. A cycle in the stored graph means every date
  // downstream of it is meaningless, so none are offered.
  const cycle = detectCycle(tasks, deps);
  if (cycle) {
    return {
      ...empty,
      cycle,
      tasks: tasks.map((t) => blankScheduled(t, deps)),
    };
  }

  const anchor = snapToWorkingDay(
    bundle.project?.start_date ??
      tasks
        .map((t) => t.planned_start)
        .filter(isISODate)
        .sort()[0] ??
      todayISO(),
    calendar
  );

  const ordered = topoSort(tasks, deps);
  const rows = forwardPass(ordered, deps, calendar, anchor);

  const projectFinish =
    [...rows.values()]
      .map((r) => r.early_finish)
      .sort((a, b) => toDayNumber(b) - toDayNumber(a))[0] ?? anchor;

  backwardPass(ordered, deps, calendar, rows, projectFinish);

  const { successors, predecessors } = buildGraph(tasks, deps);
  const baselineByTask = new Map(
    (bundle.baseline ?? []).map((b) => [b.task_id, b])
  );
  const statusById = new Map(tasks.map((t) => [t.id, t.status]));

  // The most recent sign-off per task, and the set that were actually
  // approved (migration 0020).
  //
  // 'approved_with_snags' counts as approved: on site that is what "signed off
  // with a snag list" means — the next trade starts, and the snags are chased
  // separately through the snagging list (0022). Treating it as unsigned would
  // stop the programme for something everybody has already agreed to.
  const latestSignoff = new Map<string, TaskSignoff>();
  for (const s of bundle.signoffs ?? []) {
    const held = latestSignoff.get(s.task_id);
    if (!held || s.signed_at > held.signed_at) latestSignoff.set(s.task_id, s);
  }
  const approvedTasks = new Set(
    [...latestSignoff.values()]
      .filter(
        (s) => s.outcome === "approved" || s.outcome === "approved_with_snags"
      )
      .map((s) => s.task_id)
  );

  const scheduled: ScheduledTask[] = ordered.map((task) => {
    const row = rows.get(task.id)!;
    const total_float = workingDaysBetween(
      row.early_start,
      row.late_start,
      calendar
    );

    // Free float: how far this task can slip before it delays the EARLIEST
    // start of anything that follows it — as opposed to total float, which is
    // how far it can slip before it delays the PROJECT. A task can have plenty
    // of the second and none of the first.
    const edges = successors.get(task.id) ?? [];
    let free_float = total_float;
    for (const dep of edges) {
      const succ = rows.get(dep.successor_id);
      if (!succ) continue;
      // The lag is applied exactly as the forward pass applied it — calendar
      // days — or the slack measured here would not be the slack the engine
      // actually left.
      const lag = Number(dep.lag_days ?? 0);
      const slack =
        dep.dep_type === "SS" || dep.dep_type === "SF"
          ? workingDaysBetween(
              addLag(row.early_start, lag, calendar),
              succ.early_start,
              calendar
            )
          : workingDaysBetween(
              addLag(row.early_finish, 1 + lag, calendar),
              succ.early_start,
              calendar
            );
      free_float = Math.min(free_float, slack);
    }

    const preds = predecessors.get(task.id) ?? [];
    const live = task.status !== "Complete" && task.status !== "Cancelled";

    const waitingOnWork =
      live &&
      preds.some((d) => {
        const s = statusById.get(d.predecessor_id);
        return s !== undefined && s !== "Complete" && s !== "Cancelled";
      });

    // The spec's own example — "the plasterer can't start until first fix is
    // SIGNED OFF" — is not the same constraint as "until first fix finishes"
    // (migration 0020). A predecessor that is Complete but unsigned still
    // blocks, when the link says it should.
    //
    // Reported as its own reason rather than folded into "Blocked", because
    // the two send you to chase different people: one is a trade who has not
    // finished, the other is a signature nobody has given.
    const waitingOnSignoff =
      live &&
      !waitingOnWork &&
      preds.some((d) => {
        if (!d.requires_signoff) return false;
        const s = statusById.get(d.predecessor_id);
        // An unfinished predecessor is already covered above, and a cancelled
        // one cannot be signed off and must not block for ever.
        if (s !== "Complete") return false;
        return approvedTasks.has(d.predecessor_id) === false;
      });

    const base = baselineByTask.get(task.id);

    return {
      ...task,
      computed_start: row.early_start,
      computed_end: row.early_finish,
      early_start: row.early_start,
      early_finish: row.early_finish,
      late_start: row.late_start,
      late_finish: row.late_finish,
      total_float,
      free_float,
      is_critical: total_float <= 0,
      is_blocked: waitingOnWork || waitingOnSignoff,
      blocked_reason: waitingOnWork
        ? "predecessor"
        : waitingOnSignoff
          ? "signoff"
          : null,
      signoff: latestSignoff.get(task.id) ?? null,
      predecessor_ids: preds.map((d) => d.predecessor_id),
      successor_ids: edges.map((d) => d.successor_id),
      // Calendar days, per rule 3 — this is the "how late are we" number.
      drift_start_days: driftDays(base?.planned_start, row.early_start),
      drift_end_days: driftDays(base?.planned_end, row.early_finish),
    };
  });

  const baselineCompletion =
    (bundle.baseline ?? [])
      .map((b) => b.planned_end)
      .filter(isISODate)
      .sort()
      .reverse()[0] ?? null;

  return {
    tasks: scheduled,
    completion: projectFinish,
    baseline_completion: baselineCompletion,
    completion_drift_days: baselineCompletion
      ? calendarDaysBetween(baselineCompletion, projectFinish)
      : null,
    critical_task_ids: scheduled.filter((t) => t.is_critical).map((t) => t.id),
    cycle: null,
  };
}

function driftDays(baseline: string | null | undefined, current: string): number | null {
  return isISODate(baseline) ? calendarDaysBetween(baseline, current) : null;
}

/** A task with every computed field null — what a cycle leaves behind. */
function blankScheduled(task: Task, deps: TaskDependency[]): ScheduledTask {
  return {
    ...task,
    computed_start: null,
    computed_end: null,
    early_start: null,
    early_finish: null,
    late_start: null,
    late_finish: null,
    total_float: null,
    free_float: null,
    is_critical: false,
    is_blocked: false,
    blocked_reason: null,
    signoff: null,
    predecessor_ids: deps
      .filter((d) => d.successor_id === task.id)
      .map((d) => d.predecessor_id),
    successor_ids: deps
      .filter((d) => d.predecessor_id === task.id)
      .map((d) => d.successor_id),
    drift_start_days: null,
    drift_end_days: null,
  };
}

/** Baseline drift for the whole project, per task. Used by the Drift column. */
export function driftVsBaseline(
  scheduled: ScheduledTask[],
  baseline: TaskBaseline[]
): Map<string, { start: number | null; end: number | null }> {
  const byTask = new Map(baseline.map((b) => [b.task_id, b]));
  const out = new Map<string, { start: number | null; end: number | null }>();
  for (const task of scheduled) {
    const base = byTask.get(task.id);
    if (!base) continue;
    out.set(task.id, {
      start:
        isISODate(base.planned_start) && isISODate(task.computed_start)
          ? calendarDaysBetween(base.planned_start, task.computed_start)
          : null,
      end:
        isISODate(base.planned_end) && isISODate(task.computed_end)
          ? calendarDaysBetween(base.planned_end, task.computed_end)
          : null,
    });
  }
  return out;
}

// ============================================================
// Auto-shift — the knock-on effect, computed but never written
// ============================================================

export interface ShiftChange {
  task_id: string;
  from_start: string | null;
  to_start: string | null;
  from_end: string | null;
  to_end: string | null;
  days: number;
  knock_on: boolean;
}

/**
 * Move one task, and work out what that does to everything downstream.
 *
 * Returns a NEW bundle plus the list of what moved. Nothing here mutates, and
 * nothing here writes: the caller shows the list, the user confirms, and only
 * then does a route handler save it. That preview-then-confirm split is the
 * difference between a scheduler and a thing that silently rewrites twenty rows.
 *
 * The mechanism is deliberately dull: pin the edited task's dates onto a copy
 * of the bundle and re-run `scheduleProject`. Downstream tasks move because
 * their constraints move, which means the preview and the saved result are
 * computed by exactly the same code.
 */
export function applyShift(
  bundle: ScheduleBundle,
  taskId: string,
  next: {
    planned_start?: string | null;
    planned_end?: string | null;
    duration_days?: number | null;
  }
): { bundle: ScheduleBundle; before: ScheduleResult; after: ScheduleResult; changes: ShiftChange[] } {
  const before = scheduleProject(bundle);

  const updatedTasks = bundle.tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          planned_start:
            next.planned_start !== undefined ? next.planned_start : t.planned_start,
          planned_end:
            next.planned_end !== undefined ? next.planned_end : t.planned_end,
          duration_days:
            next.duration_days !== undefined ? next.duration_days : t.duration_days,
        }
      : t
  );
  const nextBundle: ScheduleBundle = { ...bundle, tasks: updatedTasks };
  const after = scheduleProject(nextBundle);

  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const changes: ShiftChange[] = [];
  for (const task of after.tasks) {
    const was = beforeById.get(task.id);
    if (!was) continue;
    if (
      was.computed_start === task.computed_start &&
      was.computed_end === task.computed_end
    )
      continue;
    changes.push({
      task_id: task.id,
      from_start: was.computed_start,
      to_start: task.computed_start,
      from_end: was.computed_end,
      to_end: task.computed_end,
      days:
        isISODate(was.computed_start) && isISODate(task.computed_start)
          ? calendarDaysBetween(was.computed_start, task.computed_start)
          : 0,
      // The edited task is a decision; everything else is a consequence, and
      // the revision log records the difference.
      knock_on: task.id !== taskId,
    });
  }

  return { bundle: nextBundle, before, after, changes };
}

/**
 * Tasks whose order-by date falls inside the next `days` days.
 *
 * "Order by" is `planned_start − lead_time_days`, in calendar days, because a
 * merchant's lead time is quoted in calendar days and does not care that
 * Saturday is not a working day. This is how joinery and windows slip.
 */
export function orderByDate(task: Pick<Task, "lead_time_days">, start: string | null): string | null {
  if (!isISODate(start) || !task.lead_time_days || task.lead_time_days <= 0)
    return null;
  return addCalendarDays(start, -task.lead_time_days);
}

export function leadTimeAlerts(
  tasks: ScheduledTask[],
  withinDays = 14,
  today = todayISO()
): { task: ScheduledTask; order_by: string; days_left: number }[] {
  const out: { task: ScheduledTask; order_by: string; days_left: number }[] = [];
  for (const task of tasks) {
    if (task.status === "Complete" || task.status === "Cancelled") continue;
    const by = orderByDate(task, task.computed_start);
    if (!by) continue;
    const daysLeft = calendarDaysBetween(today, by);
    if (daysLeft <= withinDays) out.push({ task, order_by: by, days_left: daysLeft });
  }
  return out.sort((a, b) => a.days_left - b.days_left);
}
