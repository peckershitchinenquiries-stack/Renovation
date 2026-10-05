// Unit tests for the scheduling engine (lib/schedule.ts).
//
// Run with: npm test
// (node --experimental-strip-types --test lib/*.test.mts — Node's built-in
// runner, the only test infrastructure this repo has; see CLAUDE.md.)
//
// Why this file exists when nothing else in the app has tests
// ----------------------------------------------------------
// `npm run build` is the verification step everywhere else, and for CRUD and
// derived totals that is defensible: a wrong figure is visible on screen. A
// critical-path algorithm is not. A forward pass that is off by one over a
// weekend produces dates that look completely plausible and are wrong by a day
// a week, and nobody notices until the completion date is a fortnight out.
//
// So the rules below are pinned here, deliberately, in the same order the
// engine's file header states them:
//
//   1. duration is authoritative
//   2. planned_start is "start no earlier than", always
//   3. float is working days, drift and LAG are calendar days
//   4. cycles are refused, not survived

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORK_CALENDAR,
  addLag,
  applyShift,
  calendarDaysBetween,
  describeWeekdays,
  detectCycle,
  durationFromDates,
  endFromDuration,
  inclusiveWorkingDays,
  isWorkingDay,
  leadTimeAlerts,
  phaseActualDates,
  scheduleProject,
  shiftWorkingDays,
  snapToWorkingDay,
  taskDurationDays,
  taskProgressRollup,
  topoSort,
  workingDaysBetween,
} from "./schedule.ts";

// ============================================================
// Fixtures
// ============================================================
// 2026-03-02 is a Monday. Every date in this file is chosen against that so a
// failure reads as "it crossed the weekend wrong", not "which day was that?".
//
//   Mon 2026-03-02  Tue 03  Wed 04  Thu 05  Fri 06
//   Sat 07  Sun 08
//   Mon 2026-03-09  Tue 10  Wed 11  Thu 12  Fri 13

const MONDAY = "2026-03-02";
const FRIDAY = "2026-03-06";
const SATURDAY = "2026-03-07";
const NEXT_MONDAY = "2026-03-09";

let seq = 0;
function task(overrides: Record<string, unknown> = {}): any {
  seq += 1;
  return {
    id: `t${seq}`,
    user_id: "u",
    project_id: "p",
    phase_id: null,
    name: `Task ${seq}`,
    trade: null,
    assignee_contact_id: null,
    planned_start: null,
    planned_end: null,
    actual_start: null,
    actual_end: null,
    duration_days: 1,
    progress_pct: 0,
    status: "Not started",
    budget_amount: null,
    weather_sensitive: false,
    lead_time_days: null,
    hire_daily_rate: null,
    notes: null,
    sort_order: seq,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function dep(
  predecessor_id: string,
  successor_id: string,
  overrides: Record<string, unknown> = {}
): any {
  return {
    id: `${predecessor_id}->${successor_id}`,
    user_id: "u",
    project_id: "p",
    predecessor_id,
    successor_id,
    dep_type: "FS",
    lag_days: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function bundle(tasks: any[], dependencies: any[] = [], extra: any = {}): any {
  return {
    project: { id: "p", name: "Test", start_date: MONDAY, ...(extra.project ?? {}) },
    phases: [],
    tasks,
    dependencies,
    baseline: extra.baseline ?? [],
    baseline_name: extra.baseline_name ?? null,
    revisions: [],
    // Migration 0020. Defaulted to empty so every test written before
    // sign-off existed keeps meaning what it meant.
    signoffs: extra.signoffs ?? [],
    calendar: extra.calendar ?? DEFAULT_WORK_CALENDAR,
  };
}

const byId = (result: { tasks: any[] }, id: string) =>
  result.tasks.find((t) => t.id === id)!;

// ============================================================
// The working calendar — rule 3's foundation
// ============================================================

test("calendar: Saturday and Sunday are not working days by default", () => {
  assert.equal(isWorkingDay(FRIDAY), true);
  assert.equal(isWorkingDay(SATURDAY), false);
  assert.equal(isWorkingDay("2026-03-08"), false); // Sunday
  assert.equal(isWorkingDay(NEXT_MONDAY), true);
});

test("calendar: a listed holiday is not a working day even on a weekday", () => {
  const cal = { working_weekdays: [1, 2, 3, 4, 5], holidays: ["2026-03-04"] };
  assert.equal(isWorkingDay("2026-03-04", cal), false);
  assert.equal(isWorkingDay("2026-03-05", cal), true);
});

test("calendar: a six-day week is honoured", () => {
  const cal = { working_weekdays: [1, 2, 3, 4, 5, 6], holidays: [] };
  assert.equal(isWorkingDay(SATURDAY, cal), true);
});

test("snapToWorkingDay moves a weekend date onto the Monday", () => {
  assert.equal(snapToWorkingDay(SATURDAY), NEXT_MONDAY);
  // …and backwards onto the Friday when asked to.
  assert.equal(snapToWorkingDay(SATURDAY, DEFAULT_WORK_CALENDAR, -1), FRIDAY);
  // A date that is already a working day is returned untouched.
  assert.equal(snapToWorkingDay(MONDAY), MONDAY);
});

test("shiftWorkingDays steps over the weekend, not through it", () => {
  assert.equal(shiftWorkingDays(MONDAY, 4), FRIDAY);
  assert.equal(shiftWorkingDays(MONDAY, 5), NEXT_MONDAY);
  assert.equal(shiftWorkingDays(NEXT_MONDAY, -1), FRIDAY);
  assert.equal(shiftWorkingDays(MONDAY, 0), MONDAY);
});

test("workingDaysBetween is a signed delta, and the weekend counts for nothing", () => {
  assert.equal(workingDaysBetween(MONDAY, MONDAY), 0);
  assert.equal(workingDaysBetween(MONDAY, FRIDAY), 4);
  // Friday to Monday is ONE working day of movement, not three.
  assert.equal(workingDaysBetween(FRIDAY, NEXT_MONDAY), 1);
  assert.equal(workingDaysBetween(NEXT_MONDAY, FRIDAY), -1);
});

test("inclusiveWorkingDays counts both ends — a Mon–Fri task is five days", () => {
  assert.equal(inclusiveWorkingDays(MONDAY, FRIDAY), 5);
  assert.equal(inclusiveWorkingDays(MONDAY, MONDAY), 1);
});

test("the Friday + 3 days edge case: it finishes on the Tuesday", () => {
  // The exact case the plan flagged. Three working days starting Friday are
  // Fri, Mon, Tue — a calendar-day implementation would say Sunday.
  assert.equal(endFromDuration(FRIDAY, 3), "2026-03-10");
});

test("a holiday inside a task pushes its finish out by a day", () => {
  const cal = { working_weekdays: [1, 2, 3, 4, 5], holidays: ["2026-03-04"] };
  // Mon, Tue, (Wed is a holiday), Thu → 3 working days ends Thursday.
  assert.equal(endFromDuration(MONDAY, 3, cal), "2026-03-05");
});

// ============================================================
// Rule 1 — duration is authoritative
// ============================================================

test("taskDurationDays prefers duration_days over the typed dates", () => {
  // The dates say five days; the duration says two. The duration wins, and
  // the scheduler will move planned_end accordingly.
  assert.equal(
    taskDurationDays({ duration_days: 2, planned_start: MONDAY, planned_end: FRIDAY }),
    2
  );
});

test("taskDurationDays measures the dates when no duration is set", () => {
  assert.equal(
    taskDurationDays({ duration_days: null, planned_start: MONDAY, planned_end: FRIDAY }),
    5
  );
  // A sketched task with nothing on it still draws a one-day bar.
  assert.equal(
    taskDurationDays({ duration_days: null, planned_start: null, planned_end: null }),
    1
  );
});

test("a task's computed end comes from its duration, not its typed end", () => {
  const a = task({ planned_start: MONDAY, planned_end: FRIDAY, duration_days: 2 });
  const result = scheduleProject(bundle([a]));
  assert.equal(byId(result, a.id).computed_start, MONDAY);
  assert.equal(byId(result, a.id).computed_end, "2026-03-03");
});

// ============================================================
// Rule 2 — planned_start is "start no earlier than"
// ============================================================

test("a typed start holds a task back even when nothing precedes it", () => {
  const a = task({ planned_start: NEXT_MONDAY, duration_days: 1 });
  // The project starts a week earlier; the task does not float back to it.
  const result = scheduleProject(bundle([a]));
  assert.equal(byId(result, a.id).computed_start, NEXT_MONDAY);
});

test("a predecessor can push a task past its typed start, but never before it", () => {
  const a = task({ planned_start: MONDAY, duration_days: 5 }); // Mon–Fri
  const b = task({ planned_start: MONDAY, duration_days: 1 }); // wants Monday
  const result = scheduleProject(bundle([a, b], [dep(a.id, b.id)]));
  // FS: b starts the working day after a finishes — Friday + 1 = Monday.
  assert.equal(byId(result, b.id).computed_start, NEXT_MONDAY);
});

test("a task with no dates at all anchors on the project start date", () => {
  const a = task({ planned_start: null, duration_days: 3 });
  const result = scheduleProject(bundle([a]));
  assert.equal(byId(result, a.id).computed_start, MONDAY);
  assert.equal(byId(result, a.id).computed_end, "2026-03-04");
});

// ============================================================
// Dependency types
// ============================================================

test("FS with a lag inserts the lag as calendar days", () => {
  const a = task({ planned_start: MONDAY, duration_days: 1 }); // Mon
  const b = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { lag_days: 2 })])
  );
  // Finish Mon 02, + 1 day + 2 days of waiting = Thu 05, already a working day.
  assert.equal(byId(result, b.id).computed_start, "2026-03-05");
});

// Rule 3, and the case that made this worth fixing. A lag is a WAIT — screed
// dries at the weekend, concrete cures over a bank holiday — so "leave it a
// week" has to mean seven days. Walked in working days it used to mean nine,
// which is the sort of error that hides for a fortnight.
test("a 7-day lag is one week, not seven working days", () => {
  const a = task({ planned_start: MONDAY, duration_days: 1 }); // Mon 02
  const b = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { lag_days: 7 })])
  );
  // Finish Mon 02, +1 = Tue 03, +7 calendar days = Tue 10. In working days it
  // would have been Thu 12 — two days of imaginary drying time.
  assert.equal(byId(result, b.id).computed_start, "2026-03-10");
});

test("a lag that lands on a weekend still starts on the next working day", () => {
  const a = task({ planned_start: MONDAY, duration_days: 1 }); // Mon 02
  const b = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { lag_days: 4 })])
  );
  // Mon 02 + 1 + 4 = Sat 07, which is nobody's start date: snapped to Mon 09.
  assert.equal(byId(result, b.id).computed_start, NEXT_MONDAY);
});

test("addLag counts calendar days and lands on a working day", () => {
  // Fri 06 + 3 calendar days = Mon 09, which is already a working day.
  assert.equal(addLag(FRIDAY, 3, DEFAULT_WORK_CALENDAR), NEXT_MONDAY);
  // Fri 06 + 1 = Sat 07, snapped forward to Mon 09.
  assert.equal(addLag(FRIDAY, 1, DEFAULT_WORK_CALENDAR), NEXT_MONDAY);
  // Backwards, for the deadlines the backward pass computes: Mon 09 − 1 = Sun
  // 08, snapped back to Fri 06.
  assert.equal(addLag(NEXT_MONDAY, -1, DEFAULT_WORK_CALENDAR, -1), FRIDAY);
});

test("FS with a negative lag (a lead) overlaps the two tasks", () => {
  const a = task({ planned_start: MONDAY, duration_days: 5 }); // Mon–Fri
  const b = task({ duration_days: 2 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { lag_days: -2 })])
  );
  // Fri 06 + (1 − 2) = Thu 05, a working day.
  assert.equal(byId(result, b.id).computed_start, "2026-03-05");
});

test("SS starts the successor with the predecessor, not after it", () => {
  const a = task({ planned_start: MONDAY, duration_days: 5 });
  const b = task({ duration_days: 2 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { dep_type: "SS" })])
  );
  assert.equal(byId(result, b.id).computed_start, MONDAY);
});

test("FF holds the successor's FINISH to the predecessor's, pushing its start back", () => {
  const a = task({ planned_start: MONDAY, duration_days: 5 }); // ends Friday
  const b = task({ duration_days: 2 });
  const result = scheduleProject(
    bundle([a, b], [dep(a.id, b.id, { dep_type: "FF" })])
  );
  const row = byId(result, b.id);
  assert.equal(row.computed_end, FRIDAY);
  assert.equal(row.computed_start, "2026-03-05"); // two days ending Friday
});

// ============================================================
// Float and the critical path
// ============================================================

test("a chain with no slack is entirely critical", () => {
  const a = task({ planned_start: MONDAY, duration_days: 2 });
  const b = task({ duration_days: 2 });
  const c = task({ duration_days: 2 });
  const result = scheduleProject(
    bundle([a, b, c], [dep(a.id, b.id), dep(b.id, c.id)])
  );
  assert.deepEqual(
    result.critical_task_ids.slice().sort(),
    [a.id, b.id, c.id].sort()
  );
  assert.equal(byId(result, a.id).total_float, 0);
});

test("a short parallel branch carries float and is not critical", () => {
  //  long (5d) ┐
  //            ├→ finish (1d)
  //  short(1d) ┘
  const long = task({ planned_start: MONDAY, duration_days: 5 });
  const short = task({ planned_start: MONDAY, duration_days: 1 });
  const finish = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle(
      [long, short, finish],
      [dep(long.id, finish.id), dep(short.id, finish.id)]
    )
  );
  assert.equal(byId(result, long.id).is_critical, true);
  assert.equal(byId(result, short.id).is_critical, false);
  // The short branch can slip four working days before it matters.
  assert.equal(byId(result, short.id).total_float, 4);
  assert.equal(byId(result, finish.id).is_critical, true);
});

test("free float is the slack before the NEXT task moves, not the project", () => {
  const long = task({ planned_start: MONDAY, duration_days: 5 });
  const short = task({ planned_start: MONDAY, duration_days: 1 });
  const finish = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle(
      [long, short, finish],
      [dep(long.id, finish.id), dep(short.id, finish.id)]
    )
  );
  const row = byId(result, short.id);
  // Both are 4 here — but they are computed separately and free float can
  // never exceed total float, which is the invariant worth pinning.
  assert.ok(row.free_float !== null && row.total_float !== null);
  assert.ok(row.free_float! <= row.total_float!);
});

test("float is measured in WORKING days — a weekend is not slack", () => {
  // A one-day task that could start any time in a week has four days of
  // float, not six.
  const long = task({ planned_start: MONDAY, duration_days: 5 });
  const short = task({ planned_start: MONDAY, duration_days: 1 });
  const finish = task({ duration_days: 1 });
  const result = scheduleProject(
    bundle(
      [long, short, finish],
      [dep(long.id, finish.id), dep(short.id, finish.id)]
    )
  );
  assert.equal(byId(result, short.id).total_float, 4);
});

// ============================================================
// Rule 4 — cycles are refused
// ============================================================

test("detectCycle finds a two-task loop and names both tasks", () => {
  const a = task();
  const b = task();
  const cycle = detectCycle([a, b], [dep(a.id, b.id), dep(b.id, a.id)]);
  assert.ok(cycle);
  assert.ok(cycle!.includes(a.id) && cycle!.includes(b.id));
});

test("detectCycle finds a longer loop", () => {
  const a = task();
  const b = task();
  const c = task();
  const cycle = detectCycle(
    [a, b, c],
    [dep(a.id, b.id), dep(b.id, c.id), dep(c.id, a.id)]
  );
  assert.ok(cycle);
});

test("detectCycle returns null for a diamond, which is not a loop", () => {
  const a = task();
  const b = task();
  const c = task();
  const d = task();
  assert.equal(
    detectCycle(
      [a, b, c, d],
      [dep(a.id, b.id), dep(a.id, c.id), dep(b.id, d.id), dep(c.id, d.id)]
    ),
    null
  );
});

test("scheduleProject refuses a cyclic graph rather than looping", () => {
  const a = task({ planned_start: MONDAY });
  const b = task();
  const result = scheduleProject(bundle([a, b], [dep(a.id, b.id), dep(b.id, a.id)]));
  assert.ok(result.cycle);
  assert.equal(result.completion, null);
  // Every task comes back undated — no half-truthful dates from a broken graph.
  assert.equal(byId(result, a.id).computed_start, null);
});

test("topoSort puts every task after its predecessors", () => {
  const a = task();
  const b = task();
  const c = task();
  const order = topoSort([c, b, a], [dep(a.id, b.id), dep(b.id, c.id)]).map(
    (t) => t.id
  );
  assert.deepEqual(order, [a.id, b.id, c.id]);
});

// ============================================================
// Baseline drift — rule 3's other half
// ============================================================

test("drift is measured in CALENDAR days: a week late reads as seven", () => {
  const a = task({ planned_start: NEXT_MONDAY, duration_days: 1 });
  const baseline = [
    {
      id: "b1",
      user_id: "u",
      project_id: "p",
      task_id: a.id,
      baseline_name: "Baseline 1",
      planned_start: MONDAY,
      planned_end: MONDAY,
      duration_days: 1,
      budget_amount: null,
      captured_at: "2026-01-01T00:00:00Z",
      captured_by: null,
    },
  ];
  const result = scheduleProject(bundle([a], [], { baseline }));
  // Mon 2 March → Mon 9 March. Seven calendar days, five working days: the
  // builder is "a week late", which is the number that goes on screen.
  assert.equal(byId(result, a.id).drift_start_days, 7);
  assert.equal(result.completion_drift_days, 7);
});

test("no baseline means no drift, not a drift of zero", () => {
  const a = task({ planned_start: MONDAY });
  const result = scheduleProject(bundle([a]));
  assert.equal(byId(result, a.id).drift_start_days, null);
  assert.equal(result.completion_drift_days, null);
});

// ============================================================
// Auto-shift — the knock-on effect
// ============================================================

test("applyShift moves the downstream chain and reports every task it moved", () => {
  const a = task({ planned_start: MONDAY, duration_days: 1 });
  const b = task({ duration_days: 1 });
  const last = task({ duration_days: 1 });
  const b0 = bundle([a, b, last], [dep(a.id, b.id), dep(b.id, last.id)]);

  const { changes, before, after } = applyShift(b0, a.id, {
    planned_start: "2026-03-04", // Monday → Wednesday
  });

  assert.equal(before.completion, "2026-03-04"); // Mon, Tue, Wed
  assert.equal(after.completion, "2026-03-06"); // Wed, Thu, Fri
  assert.equal(changes.length, 3);
  // The edited task is a decision; the other two are consequences, and that
  // distinction is what makes the revision log worth reading later.
  assert.equal(changes.find((row) => row.task_id === a.id)!.knock_on, false);
  assert.equal(changes.find((row) => row.task_id === last.id)!.knock_on, true);
});

test("applyShift does not mutate the bundle it was given", () => {
  const a = task({ planned_start: MONDAY, duration_days: 1 });
  const b0 = bundle([a]);
  applyShift(b0, a.id, { planned_start: NEXT_MONDAY });
  assert.equal(b0.tasks[0].planned_start, MONDAY);
});

test("a slip absorbed by float moves fewer tasks than days", () => {
  // The short branch has four days of float, so pushing it two days moves
  // nothing else and does not touch the completion date.
  const long = task({ planned_start: MONDAY, duration_days: 5 });
  const short = task({ planned_start: MONDAY, duration_days: 1 });
  const finish = task({ duration_days: 1 });
  const b0 = bundle(
    [long, short, finish],
    [dep(long.id, finish.id), dep(short.id, finish.id)]
  );

  const { changes, before, after } = applyShift(b0, short.id, {
    planned_start: "2026-03-04",
  });

  assert.equal(changes.length, 1); // only the task that was edited
  assert.equal(before.completion, after.completion);
});

// ============================================================
// Resizing — rule 1 cuts both ways
// ============================================================
// `duration_days` being authoritative means a new END date does nothing on its
// own. Every screen that lets somebody type or drag one therefore has to
// convert it into a duration first, which is what durationFromDates is for.
// Without it the shift preview reported "no change" and the save then wrote the
// old duration's end date back over what the user had just typed.

test("durationFromDates measures an inclusive span in working days", () => {
  // Mon–Fri is five working days, counting both ends.
  assert.equal(durationFromDates(MONDAY, FRIDAY, DEFAULT_WORK_CALENDAR), 5);
  // Mon to the following Monday is six: the weekend is not work.
  assert.equal(durationFromDates(MONDAY, NEXT_MONDAY, DEFAULT_WORK_CALENDAR), 6);
  // One day is one day, not zero.
  assert.equal(durationFromDates(MONDAY, MONDAY, DEFAULT_WORK_CALENDAR), 1);
});

test("durationFromDates refuses a half-answer rather than inventing one", () => {
  assert.equal(durationFromDates(MONDAY, null), undefined);
  assert.equal(durationFromDates(null, FRIDAY), undefined);
  assert.equal(durationFromDates(MONDAY, ""), undefined);
  // Backwards dates are a typo, not a negative duration.
  assert.equal(durationFromDates(FRIDAY, MONDAY, DEFAULT_WORK_CALENDAR), undefined);
});

test("a new end date only resizes a task once it is turned into a duration", () => {
  const a = task({ planned_start: MONDAY, planned_end: "2026-03-04", duration_days: 3 });

  // What the shift dialog used to send: the dates alone. The duration wins, so
  // the bar does not move at all.
  const ignored = applyShift(bundle([a]), a.id, {
    planned_start: MONDAY,
    planned_end: FRIDAY,
  });
  assert.equal(byId(ignored.after, a.id).computed_end, "2026-03-04");
  assert.equal(ignored.changes.length, 0);

  // What it sends now.
  const duration = durationFromDates(MONDAY, FRIDAY, DEFAULT_WORK_CALENDAR);
  const resized = applyShift(bundle([a]), a.id, {
    planned_start: MONDAY,
    planned_end: FRIDAY,
    duration_days: duration,
  });
  assert.equal(duration, 5);
  assert.equal(byId(resized.after, a.id).computed_end, FRIDAY);
  assert.equal(resized.changes.length, 1);
});

test("a task with no stored duration keeps its length when both dates travel", () => {
  // The scenario-drag bug: sending a null end collapsed a task whose length
  // came from its dates down to a single day, and everything downstream pulled
  // forward with it.
  const a = task({ planned_start: MONDAY, planned_end: FRIDAY, duration_days: null });

  const collapsed = applyShift(bundle([a]), a.id, {
    planned_start: NEXT_MONDAY,
    planned_end: null,
  });
  assert.equal(byId(collapsed.after, a.id).computed_end, NEXT_MONDAY); // one day

  const moved = applyShift(bundle([a]), a.id, {
    planned_start: NEXT_MONDAY,
    planned_end: "2026-03-13",
  });
  assert.equal(byId(moved.after, a.id).computed_end, "2026-03-13"); // still five
});

// ============================================================
// The small derivations
// ============================================================

test("phaseActualDates takes min start and max end, and withholds an end while work is open", () => {
  const done = task({ actual_start: MONDAY, actual_end: "2026-03-04" });
  const alsoDone = task({ actual_start: "2026-03-03", actual_end: FRIDAY });
  assert.deepEqual(phaseActualDates([done, alsoDone]), {
    start: MONDAY,
    end: FRIDAY,
  });

  const open = task({ actual_start: "2026-03-05", actual_end: null });
  assert.deepEqual(phaseActualDates([done, open]), { start: MONDAY, end: null });
});

test("progress is duration-weighted: a long task at 50% outweighs a short one at 100%", () => {
  const long = task({ duration_days: 9, progress_pct: 50 });
  const short = task({ duration_days: 1, progress_pct: 100 });
  // (9×50 + 1×100) / 10 = 55, not the unweighted 75.
  assert.equal(taskProgressRollup([long, short]), 55);
});

test("cancelled tasks are excluded from progress — they are not work remaining", () => {
  const live = task({ duration_days: 1, progress_pct: 100 });
  const dead = task({ duration_days: 1, progress_pct: 0, status: "Cancelled" });
  assert.equal(taskProgressRollup([live, dead]), 100);
});

test("a project with no tasks is 0% complete, not NaN", () => {
  assert.equal(taskProgressRollup([]), 0);
});

test("blocked means a predecessor is unfinished, not merely that one exists", () => {
  const done = task({ status: "Complete", planned_start: MONDAY });
  const open = task({ status: "In progress", planned_start: MONDAY });
  const after = task();
  const afterDone = task();
  const result = scheduleProject(
    bundle(
      [done, open, after, afterDone],
      [dep(open.id, after.id), dep(done.id, afterDone.id)]
    )
  );
  assert.equal(byId(result, after.id).is_blocked, true);
  assert.equal(byId(result, afterDone.id).is_blocked, false);
});

test("lead-time alerts fire on the order-by date, in calendar days", () => {
  const joinery = task({ planned_start: "2026-04-06", lead_time_days: 28 });
  const result = scheduleProject(
    bundle([joinery], [], { project: { start_date: "2026-03-02" } })
  );
  // Order by 9 March; on 2 March that is seven days away, inside a fortnight.
  const alerts = leadTimeAlerts(result.tasks, 14, MONDAY);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].order_by, "2026-03-09");
  assert.equal(alerts[0].days_left, 7);

  // A month earlier it is not yet worth mentioning.
  assert.equal(leadTimeAlerts(result.tasks, 14, "2026-02-01").length, 0);
});

test("calendarDaysBetween counts weekends, unlike its working-day sibling", () => {
  assert.equal(calendarDaysBetween(FRIDAY, NEXT_MONDAY), 3);
  assert.equal(workingDaysBetween(FRIDAY, NEXT_MONDAY), 1);
});

// ============================================================
// Sign-off blocking (migration 0020)
// ============================================================
// `requires_signoff` on a dependency is a different constraint from a finish
// date: the spec's own example is "the plasterer can't start until first fix is
// SIGNED OFF". A predecessor that is finished but unsigned still blocks.
//
// These four cases are the whole of the rule, and the reason they are pinned
// here is that three of them look identical on screen — a task showing
// "Blocked" — while meaning three different things.

function signoff(task_id: string, outcome: string, at = "2026-03-05T09:00:00Z") {
  return {
    id: `so-${task_id}-${at}`,
    user_id: "u",
    project_id: "p",
    task_id,
    signed_by: "u",
    signed_at: at,
    outcome,
    note: null,
  };
}

test("sign-off: a complete but unsigned predecessor blocks, and says why", () => {
  const first = task({ status: "Complete" });
  const plasterer = task();
  const result = scheduleProject(
    bundle([first, plasterer], [
      dep(first.id, plasterer.id, { requires_signoff: true }),
    ])
  );
  const row = byId(result, plasterer.id);
  assert.equal(row.is_blocked, true);
  // Not "predecessor": the work IS finished. Sending somebody to chase the
  // trade rather than the signature is the mistake this field prevents.
  assert.equal(row.blocked_reason, "signoff");
});

test("sign-off: an approved predecessor unblocks it", () => {
  const first = task({ status: "Complete" });
  const plasterer = task();
  const result = scheduleProject(
    bundle(
      [first, plasterer],
      [dep(first.id, plasterer.id, { requires_signoff: true })],
      { signoffs: [signoff(first.id, "approved")] }
    )
  );
  assert.equal(byId(result, plasterer.id).is_blocked, false);
  assert.equal(byId(result, plasterer.id).blocked_reason, null);
});

test("sign-off: 'approved with snags' counts as approved", () => {
  // On site that is what signing off with a snag list means — the next trade
  // starts and the snags are chased separately through the snagging list
  // (0022). Treating it as unsigned would stop the programme for something
  // everybody has already agreed to.
  const first = task({ status: "Complete" });
  const plasterer = task();
  const result = scheduleProject(
    bundle(
      [first, plasterer],
      [dep(first.id, plasterer.id, { requires_signoff: true })],
      { signoffs: [signoff(first.id, "approved_with_snags")] }
    )
  );
  assert.equal(byId(result, plasterer.id).is_blocked, false);
});

test("sign-off: a rejection still blocks, and the LATEST outcome wins", () => {
  const first = task({ status: "Complete" });
  const plasterer = task();

  const rejected = scheduleProject(
    bundle(
      [first, plasterer],
      [dep(first.id, plasterer.id, { requires_signoff: true })],
      { signoffs: [signoff(first.id, "rejected")] }
    )
  );
  assert.equal(byId(rejected, plasterer.id).blocked_reason, "signoff");

  // Approved first, then rejected later: the later record is the one that
  // stands. Sign-offs are append-only (0020) — withdrawing one means
  // recording a second, later outcome, so ordering by signed_at is the whole
  // of how a withdrawal works.
  const reopened = scheduleProject(
    bundle(
      [first, plasterer],
      [dep(first.id, plasterer.id, { requires_signoff: true })],
      {
        signoffs: [
          signoff(first.id, "approved", "2026-03-05T09:00:00Z"),
          signoff(first.id, "rejected", "2026-03-06T09:00:00Z"),
        ],
      }
    )
  );
  assert.equal(byId(reopened, plasterer.id).is_blocked, true);
  assert.equal(byId(reopened, plasterer.id).blocked_reason, "signoff");
  // And the task carries the latest record, for the badge.
  assert.equal(byId(reopened, first.id).signoff.outcome, "rejected");
});

test("sign-off: an unfinished predecessor reports the WORK, not the signature", () => {
  // Both are true — it is unfinished and unsigned — but only one of them is
  // actionable today, and it is not the signature.
  const first = task({ status: "In progress" });
  const plasterer = task();
  const result = scheduleProject(
    bundle([first, plasterer], [
      dep(first.id, plasterer.id, { requires_signoff: true }),
    ])
  );
  assert.equal(byId(result, plasterer.id).blocked_reason, "predecessor");
});

test("sign-off: a link that does not require it is unaffected", () => {
  const first = task({ status: "Complete" });
  const plasterer = task();
  const result = scheduleProject(
    bundle([first, plasterer], [dep(first.id, plasterer.id)])
  );
  assert.equal(byId(result, plasterer.id).is_blocked, false);
});


// ============================================================
// The calendar is configurable, and configuring it moves the dates
// ============================================================
// Added 2026-10-01 with the Working-calendar panel. `working_weekdays` and
// `project_holidays` existed from migration 0018 and were read by the engine,
// but nothing in the app could write either — so every project ran on the
// column default of Mon–Fri with no holidays, and a Saturday-working crew or a
// Christmas shutdown produced dates that were wrong by a day a week and looked
// entirely plausible. These tests pin the thing that fix depends on: that a
// different calendar genuinely produces different dates, end to end through the
// forward pass, not just inside isWorkingDay().

test("calendar: a six-day week finishes a ten-day job earlier", () => {
  const ten = task({ planned_start: MONDAY, duration_days: 10 });
  const fiveDay = scheduleProject(bundle([ten]));
  const sixDay = scheduleProject(
    bundle([task({ ...ten, id: ten.id })], [], {
      calendar: { working_weekdays: [1, 2, 3, 4, 5, 6], holidays: [] },
    })
  );
  // Mon 2 Mar + 10 working days: Mon–Fri spans two weekends and ends Fri 13th;
  // working Saturdays it ends Thu 12th. One real day of difference per week,
  // which is the whole point.
  assert.equal(byId(fiveDay, ten.id).computed_end, "2026-03-13");
  assert.equal(byId(sixDay, ten.id).computed_end, "2026-03-12");
});

test("calendar: one holiday pushes the whole chain, not just the task it lands in", () => {
  const first = task({ planned_start: MONDAY, duration_days: 3 });
  const second = task({ duration_days: 2 });
  const link = [dep(first.id, second.id)];
  const clear = scheduleProject(bundle([first, second], link));
  const shut = scheduleProject(
    bundle([first, second], link, {
      // Wednesday 4 March — inside the first task.
      calendar: { working_weekdays: [1, 2, 3, 4, 5], holidays: ["2026-03-04"] },
    })
  );
  // Clear: first runs Mon–Wed, successor Thu–Fri, ending Fri 6 March.
  // Shut: the Wednesday holiday pushes first to Thu, so the successor runs Fri
  // and then MONDAY — over the weekend, which is where one lost day becomes
  // three on the calendar. A holiday that only moved the task it fell inside
  // would leave the dependency overlapping it.
  assert.equal(byId(clear, second.id).computed_end, "2026-03-06");
  assert.equal(byId(shut, second.id).computed_end, "2026-03-09");
});

test("calendar: the completion date moves with the calendar", () => {
  const only = task({ planned_start: FRIDAY, duration_days: 2 });
  const fiveDay = scheduleProject(bundle([only]));
  const sixDay = scheduleProject(
    bundle([task({ ...only, id: only.id })], [], {
      calendar: { working_weekdays: [1, 2, 3, 4, 5, 6], holidays: [] },
    })
  );
  // Two days from Friday: Fri + Mon when Saturday is off, Fri + Sat when it is
  // not. This is the figure the Schedule tab prints as "Completion".
  assert.equal(fiveDay.completion, NEXT_MONDAY);
  assert.equal(sixDay.completion, SATURDAY);
});

// ============================================================
// describeWeekdays — the label on the panel
// ============================================================

test("describeWeekdays collapses a run and refuses to collapse a gap", () => {
  assert.equal(describeWeekdays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(describeWeekdays([1, 2, 3, 4, 5, 6]), "Mon–Sat");
  // The one that matters: three non-consecutive days must NOT read as a range.
  // "Mon–Fri" for a Mon/Wed/Fri job is a lie that reads perfectly naturally.
  assert.equal(describeWeekdays([1, 3, 5]), "Mon, Wed, Fri");
  // Two days are listed rather than ranged — "Mon–Tue" is longer than "Mon, Tue"
  // and no clearer.
  assert.equal(describeWeekdays([1, 2]), "Mon, Tue");
});

test("describeWeekdays says the two extremes plainly", () => {
  assert.equal(describeWeekdays([1, 2, 3, 4, 5, 6, 7]), "every day");
  // Refused by the database and by validateWorkCalendar, but the label must not
  // render an empty string if one ever reaches it.
  assert.equal(describeWeekdays([]), "no working days");
});

test("describeWeekdays is order- and duplicate-proof", () => {
  // The column has no ordering guarantee, so a hand-written SQL update can
  // leave {5,1,3} in it and the panel still has to read correctly.
  assert.equal(describeWeekdays([5, 1, 3]), "Mon, Wed, Fri");
  // A duplicate must not make a gapped set look consecutive, nor the reverse:
  // {3,1,3} is two days with a gap, however it is written.
  assert.equal(describeWeekdays([3, 1, 3]), "Mon, Wed");
  // Three genuinely consecutive days DO range, whatever order they arrive in.
  assert.equal(describeWeekdays([3, 2, 1, 2]), "Mon–Wed");
  // Out-of-range numbers are dropped rather than crashing on ISO_WEEKDAYS[i].
  assert.equal(describeWeekdays([0, 1, 2, 9]), "Mon, Tue");
});
