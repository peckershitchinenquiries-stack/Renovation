"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { BUDGET, MONEY } from "@/lib/vocabulary";
import {
  addCalendarDays,
  applyShift,
  calendarDaysBetween,
  durationFromDates,
  endFromDuration,
  isISODate,
  leadTimeAlerts,
  scheduleProject,
  snapToWorkingDay,
  taskDurationDays,
  taskProgressRollup,
} from "@/lib/schedule";
import {
  costImpactOfShift,
  phaseCostRows,
  taskCostRows,
  projectCostRollup,
} from "@/lib/scheduleCosts";
import { fmtDate } from "@/components/project/format";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import TaskForm from "@/components/forms/TaskForm";
import PhaseForm from "@/components/forms/PhaseForm";
import Gantt from "./Gantt";
import ScenarioPanel, {
  ScenarioEditSheet,
  type ScenarioEdit,
} from "./ScenarioPanel";
import ShiftDialog from "./ShiftDialog";
import TaskSheet from "./TaskSheet";
import { UntaggedNote, VarianceChip } from "./VarianceChip";
import WorkCalendarPanel from "./WorkCalendarPanel";
import type {
  Contact,
  ExpenseEntryComputed,
  InvoiceLineView,
  ProjectPhase,
  PurchaseComputed,
  ScheduleBundle,
  ScheduledTask,
  TaskCostRow,
  TradeLookup,
} from "@/types";

/**
 * The Schedule tab — the fifth project tab.
 *
 * Five tabs is one more than the four the 2026-08-28 collapse settled on, and
 * that is justified here in the way the retired five were not: those were one
 * dataset grouped five ways, which is a pivot. This is a genuinely different
 * dataset — work and time, rather than money — with its own tables, its own
 * write path and its own vocabulary.
 *
 * Two views of it, one control:
 *
 *   * **List** — every task with its dates, float, drift and budget vs cost.
 *     This is where the spec's must-have actually lands, and it works before
 *     anything is drawn.
 *   * **Chart** — the Gantt.
 *
 * Everything on screen is computed here, in the browser, by the same pure
 * functions the server uses. The bundle comes down once; `scheduleProject`,
 * `taskCostRows` and the rest run on it. That is what makes switching view,
 * collapsing a phase or previewing a shift instant, and it is why a "what if"
 * costs nothing extra to build.
 */

type View = "list" | "chart";

export default function ScheduleTab({
  projectId,
  bundle: initialBundle,
  invoiceLines,
  purchases,
  entries,
  trades,
  contacts = [],
  onShowUntagged,
}: {
  projectId: string;
  bundle: ScheduleBundle;
  invoiceLines: InvoiceLineView[];
  purchases: PurchaseComputed[];
  entries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  /**
   * The people register (migration 0020), for the task assignee picker.
   * Empty when 0020 has not been run — the picker simply does not appear.
   */
  contacts?: Contact[];
  /** Jumps to the Analysis tab's By-task pivot, filtered to untagged lines. */
  onShowUntagged?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();

  const [bundle, setBundle] = useState(initialBundle);
  const [view, setView] = useState<View>("list");
  const [addingTask, setAddingTask] = useState<string | null | false>(false);
  const [addingPhase, setAddingPhase] = useState(false);
  const [editingPhase, setEditingPhase] = useState<ProjectPhase | null>(null);
  const [selected, setSelected] = useState<ScheduledTask | null>(null);
  const [shifting, setShifting] = useState<ScheduledTask | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [baselining, setBaselining] = useState(false);
  // Scenario mode. `null` = off. A non-null array — even an empty one — means
  // the reader is in "what if", and every date on screen is a draft that has
  // not been and will not be written until Apply.
  const [scenario, setScenario] = useState<ScenarioEdit[] | null>(null);
  const [scenarioTask, setScenarioTask] = useState<ScheduledTask | null>(null);
  // Weather-dependent work only. A one-line filter, which is the whole of the
  // manual weather feature: "this bar is weather-dependent and it is in
  // February" is most of the value a live forecast API would add, at none of
  // its operating cost.
  const [weatherOnly, setWeatherOnly] = useState(false);

  const reload = useCallback(async () => {
    const fresh = await apiFetch<{ bundle: ScheduleBundle }>(
      `/api/projects/${projectId}/schedule`
    );
    setBundle(fresh.bundle);
    // The Overview and Analysis tabs read the same tags, so the server has to
    // rebuild them too — the same pattern reloadEntries already follows.
    router.refresh();
  }, [projectId, router]);

  // Everything below is derived. Nothing here is stored, and the same
  // functions run on the server for the API's own reply.
  const schedule = useMemo(() => scheduleProject(bundle), [bundle]);
  const costRows = useMemo(
    () => taskCostRows(bundle.tasks, invoiceLines, purchases, entries),
    [bundle.tasks, invoiceLines, purchases, entries]
  );
  const costByTask = useMemo(
    () => new Map(costRows.map((r) => [r.task_id, r])),
    [costRows]
  );
  const phaseRows = useMemo(
    () => phaseCostRows(bundle.phases, bundle.tasks, costRows),
    [bundle.phases, bundle.tasks, costRows]
  );
  const rollup = useMemo(
    () => projectCostRollup(bundle.tasks, invoiceLines, purchases, entries),
    [bundle.tasks, invoiceLines, purchases, entries]
  );
  const progress = useMemo(
    () => taskProgressRollup(bundle.tasks, bundle.calendar),
    [bundle.tasks, bundle.calendar]
  );
  /**
   * The scenario, if one is running.
   *
   * Built by replaying the edits onto a COPY of the bundle and re-running the
   * same `scheduleProject` the live view uses. There is no second engine and no
   * draft row anywhere: a "what if" is literally the real calculation over
   * different input, which is why it cannot disagree with what Apply will do.
   */
  const draftBundle = useMemo(() => {
    if (!scenario || scenario.length === 0) return null;
    return scenario.reduce<ScheduleBundle>((acc, edit) => {
      // The duration is derived from the pair of dates for exactly the reason
      // the shift route derives it — `duration_days` is authoritative, so a
      // scenario that only moved the dates would preview a task at its old
      // length and disagree with what Apply then saves.
      const duration = durationFromDates(
        edit.planned_start,
        edit.planned_end,
        acc.calendar
      );
      return applyShift(acc, edit.task_id, {
        planned_start: edit.planned_start,
        planned_end: edit.planned_end,
        ...(duration !== undefined ? { duration_days: duration } : {}),
      }).bundle;
    }, bundle);
  }, [scenario, bundle]);

  const draftSchedule = useMemo(
    () => (draftBundle ? scheduleProject(draftBundle) : null),
    [draftBundle]
  );

  // What the scenario would cost: the extra days on each EDITED task, priced
  // by its hire rate and its trade's day rate. Knocked-on tasks are not priced
  // — they moved, they did not get longer, and a hire that simply starts later
  // costs the same. Claiming otherwise would inflate the figure.
  const scenarioCost = useMemo(() => {
    const empty = {
      days: 0,
      hire_cost: 0,
      labour_cost: 0,
      total: 0,
      basis: [] as string[],
      unpriced: true,
    };
    if (!scenario || !draftSchedule) return empty;
    const liveById = new Map(schedule.tasks.map((t) => [t.id, t]));
    let total = { ...empty, basis: [] as string[], unpriced: false };
    for (const edit of scenario) {
      const task = bundle.tasks.find((t) => t.id === edit.task_id);
      const before = liveById.get(edit.task_id);
      const after = draftSchedule.tasks.find((t) => t.id === edit.task_id);
      if (!task || !before || !after) continue;
      const extra =
        isISODate(before.computed_end) && isISODate(after.computed_end) &&
        isISODate(before.computed_start) && isISODate(after.computed_start)
          ? Math.max(
              0,
              calendarDaysBetween(before.computed_end, after.computed_end) -
                calendarDaysBetween(before.computed_start, after.computed_start)
            )
          : 0;
      const impact = costImpactOfShift(task, extra, trades);
      total.days += impact.days;
      total.hire_cost += impact.hire_cost;
      total.labour_cost += impact.labour_cost;
      total.total += impact.total;
      total.basis.push(...impact.basis);
    }
    total.unpriced = total.basis.length === 0;
    return total;
  }, [scenario, draftSchedule, schedule.tasks, bundle.tasks, trades]);

  // What the chart and the list actually render: the draft when a scenario is
  // running, the truth otherwise.
  const shown = draftSchedule ?? schedule;

  const orderSoon = useMemo(
    () => leadTimeAlerts(schedule.tasks, 14),
    [schedule.tasks]
  );
  const baselinedTasks = useMemo(
    () => new Set(bundle.baseline.map((b) => b.task_id)),
    [bundle.baseline]
  );

  /** Grouped for the list view, phases in order, unphased last. */
  const groups = useMemo(() => {
    const byPhase = new Map<string, ScheduledTask[]>();
    for (const task of shown.tasks) {
      if (weatherOnly && !task.weather_sensitive) continue;
      const key = task.phase_id ?? "__unphased";
      const list = byPhase.get(key) ?? [];
      list.push(task);
      byPhase.set(key, list);
    }
    const out: {
      id: string;
      phase: ProjectPhase | null;
      tasks: ScheduledTask[];
    }[] = bundle.phases.map((phase) => ({
      id: phase.id,
      phase,
      tasks: byPhase.get(phase.id) ?? [],
    }));
    const loose = byPhase.get("__unphased") ?? [];
    if (loose.length > 0)
      out.push({ id: "__unphased", phase: null, tasks: loose });
    // A phase whose every task was filtered out is dropped rather than shown
    // empty: an empty group under a heading reads as "nothing planned here",
    // which is a different and wrong statement.
    return weatherOnly ? out.filter((g) => g.tasks.length > 0) : out;
  }, [shown.tasks, bundle.phases, weatherOnly]);

  /** Replace any earlier edit of the same task, so the list stays one per task. */
  function addScenarioEdit(edit: ScenarioEdit) {
    setScenario((current) => [
      ...(current ?? []).filter((e) => e.task_id !== edit.task_id),
      edit,
    ]);
  }

  async function captureBaseline() {
    setBaselining(true);
    try {
      const result = await apiFetch<{ baseline_name: string }>(
        `/api/projects/${projectId}/schedule/baseline`,
        { method: "POST", body: JSON.stringify({}) }
      );
      toast(`${result.baseline_name} captured`, "success");
      await reload();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not baseline", "error");
    } finally {
      setBaselining(false);
    }
  }

  /**
   * A finished drag on the chart. It opens the preview rather than saving:
   * the whole point of the shift flow is that nothing is written until it has
   * been shown and confirmed.
   */
  function handleDrag(task: ScheduledTask, days: number, edge: string) {
    if (!isISODate(task.computed_start)) return;

    // Where the drag put the bar. One calculation for both branches below, so
    // a scenario drag and a live drag can never mean different things:
    //   • "end"   — resized from the right, the start stays put
    //   • "start" — resized from the left, the end stays put
    //   • "move"  — both ends travel together, and the task keeps its LENGTH
    //
    // That last point is why a move does not simply add the same offset to both
    // dates. A bar dragged across a weekend would then span a different number
    // of WORKING days, and since the end date is now read as the task's
    // duration, a plain move would quietly make the task a day longer.
    const calendar = bundle.calendar;
    const nextStart =
      edge === "end"
        ? task.computed_start
        : snapToWorkingDay(addCalendarDays(task.computed_start, days), calendar);
    const nextEnd =
      edge === "start" || !isISODate(task.computed_end)
        ? task.computed_end
        : edge === "move"
          ? endFromDuration(nextStart, taskDurationDays(task, calendar), calendar)
          : snapToWorkingDay(
              addCalendarDays(task.computed_end, days),
              calendar,
              -1
            );

    // In scenario mode a drag is a draft edit, not a request. Nothing leaves
    // the browser until Apply.
    //
    // Both dates are carried. Sending a null end used to collapse any task
    // whose length came from its dates rather than a stored duration down to a
    // single day, which made the whole what-if optimistic by however long that
    // task really was.
    if (scenario) {
      addScenarioEdit({
        task_id: task.id,
        planned_start: nextStart,
        planned_end: nextEnd,
      });
      return;
    }
    setShifting({ ...task, computed_start: nextStart, computed_end: nextEnd });
  }

  if (schedule.cycle)
    return (
      <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-inset ring-red-600/20">
        <p className="text-sm font-bold text-red-800">
          The schedule contains a loop
        </p>
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-red-700">
          These tasks depend on each other in a circle, so no date can be worked
          out:{" "}
          <strong>
            {schedule.cycle
              .map((id) => bundle.tasks.find((t) => t.id === id)?.name ?? "?")
              .join(" → ")}
          </strong>
          . Open one of them and remove a link.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      {/* The header line: where this project finishes, and how that compares
          with what was promised. */}
      <div className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-400">
              Completion
            </p>
            <p className="text-[1.375rem] font-bold leading-tight tracking-[-0.01em] text-gray-900">
              {fmtDate(schedule.completion)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xs font-bold uppercase tracking-wider text-gray-400">
              Complete
            </p>
            <p className="tnum text-[1.375rem] font-bold leading-tight text-gray-900">
              {progress}%
            </p>
          </div>
        </div>

        {schedule.completion_drift_days !== null ? (
          <p
            className={`mt-2 text-[0.8125rem] font-semibold ${
              schedule.completion_drift_days > 0
                ? "text-red-600"
                : schedule.completion_drift_days < 0
                  ? "text-emerald-700"
                  : "text-gray-500"
            }`}
          >
            {schedule.completion_drift_days === 0
              ? `On ${bundle.baseline_name ?? "baseline"}`
              : `${Math.abs(schedule.completion_drift_days)} ${
                  Math.abs(schedule.completion_drift_days) === 1 ? "day" : "days"
                } ${schedule.completion_drift_days > 0 ? "behind" : "ahead of"} ${
                  bundle.baseline_name ?? "baseline"
                }`}
          </p>
        ) : (
          <p className="mt-2 text-[0.8125rem] text-gray-500">
            No baseline captured — nothing to measure drift against yet.
          </p>
        )}

        {/* Two percentages, both named. Never one number that silently means
            the other: a job is routinely 40% built and 70% spent, and that
            gap is the most useful thing this line can say. */}
        {rollup.budget > 0 ? (
          <p className="mt-1 text-[0.8125rem] text-gray-500">
            {formatCurrency(rollup.net)} of {formatCurrency(rollup.budget)}{" "}
            task {BUDGET.label.toLowerCase()} spent (ex VAT) ={" "}
            <span className="font-semibold text-gray-700">
              {Math.round((rollup.net / rollup.budget) * 100)}%
            </span>{" "}
            by cost
          </p>
        ) : null}
      </div>

      {/* Which days this job actually works, directly above the dates it
          governs. Every figure in the card above — the completion date, the
          drift, the float behind each bar — counts WORKING days, and until
          2026-10-01 the calendar behind that could not be set from the app at
          all: every project was silently scheduled Mon–Fri with no bank
          holidays. See the note at the top of WorkCalendarPanel. */}
      <WorkCalendarPanel
        projectId={projectId}
        calendar={bundle.calendar}
        holidays={bundle.holidays}
        onChanged={reload}
      />

      <UntaggedNote rollup={rollup} onShow={onShowUntagged} />

      {orderSoon.length > 0 ? (
        <div className="rounded-2xl bg-amber-50 px-4 py-3 ring-1 ring-inset ring-amber-600/20">
          <p className="text-[0.8125rem] font-semibold text-amber-900">
            {orderSoon.length}{" "}
            {orderSoon.length === 1 ? "thing needs" : "things need"} ordering soon
          </p>
          <ul className="mt-1 space-y-0.5 text-[0.8125rem] text-amber-800">
            {orderSoon.slice(0, 4).map((alert) => (
              <li key={alert.task.id}>
                <span className="font-semibold">{alert.task.name}</span> — order by{" "}
                {fmtDate(alert.order_by)}
                {alert.days_left < 0
                  ? ` (${Math.abs(alert.days_left)} days ago)`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Schedule view"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: "List" },
            { value: "chart", label: "Chart" },
          ]}
        />
        <div className="ml-auto flex flex-wrap gap-2">
          {bundle.tasks.some((t) => t.weather_sensitive) ? (
            <button
              type="button"
              aria-pressed={weatherOnly}
              onClick={() => setWeatherOnly((w) => !w)}
              className={weatherOnly ? "btn-soft btn-sm" : "btn-ghost btn-sm"}
            >
              <Icon name="alert" size={15} />
              Weather
            </button>
          ) : null}
          <button
            type="button"
            aria-pressed={scenario !== null}
            onClick={() => setScenario((s) => (s === null ? [] : null))}
            className={scenario !== null ? "btn-soft btn-sm" : "btn-ghost btn-sm"}
            title="Try a delay without committing it"
          >
            <Icon name="sparkle" size={15} />
            What if
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setAddingPhase(true)}
          >
            <Icon name="plus" size={15} strokeWidth={2.25} />
            Phase
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setAddingTask(null)}
          >
            <Icon name="plus" size={15} strokeWidth={2.25} />
            Task
          </button>
        </div>
      </div>

      {scenario !== null ? (
        <ScenarioPanel
          projectId={projectId}
          edits={scenario}
          base={schedule}
          draft={draftSchedule ?? schedule}
          costImpact={scenarioCost}
          tasksById={new Map(schedule.tasks.map((t) => [t.id, t]))}
          baselinedTasks={baselinedTasks}
          onDiscard={() => setScenario(null)}
          onApplied={(all) => {
            // A partial apply keeps the scenario open, holding whatever did not
            // get written — closing it would throw away the only record of what
            // is still outstanding.
            if (all) setScenario(null);
            reload();
          }}
          onRemoveEdit={(taskId) =>
            setScenario((current) =>
              (current ?? []).filter((e) => e.task_id !== taskId)
            )
          }
        />
      ) : null}

      {schedule.tasks.length === 0 ? (
        <EmptyState
          icon="list"
          title="No tasks yet"
          description="Break the job into phases — demo, first fix, second fix, snagging — and add the work under them. Give each task a duration and a budget and the rest follows."
          action={
            <button
              type="button"
              className="btn-primary"
              onClick={() => setAddingTask(null)}
            >
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Add the first task
            </button>
          }
        />
      ) : view === "chart" ? (
        <Gantt
          schedule={shown}
          phases={bundle.phases}
          dependencies={bundle.dependencies}
          baseline={bundle.baseline}
          calendar={bundle.calendar}
          selectedId={selected?.id ?? null}
          onSelect={scenario !== null ? setScenarioTask : setSelected}
          onShift={handleDrag}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <PhaseGroup
              key={group.id}
              phase={group.phase}
              tasks={group.tasks}
              costByTask={costByTask}
              costRow={phaseRows.find((r) => r.phase_id === (group.phase?.id ?? null))}
              collapsed={collapsed.has(group.id)}
              onToggle={() =>
                setCollapsed((set) => {
                  const next = new Set(set);
                  if (next.has(group.id)) next.delete(group.id);
                  else next.add(group.id);
                  return next;
                })
              }
              onSelectTask={scenario !== null ? setScenarioTask : setSelected}
              onEditPhase={group.phase ? () => setEditingPhase(group.phase!) : undefined}
              onAddTask={() => setAddingTask(group.phase?.id ?? null)}
            />
          ))}
        </div>
      )}

      {schedule.tasks.length > 0 ? (
        <div className="flex justify-center">
          <button
            type="button"
            disabled={baselining}
            onClick={captureBaseline}
            className="btn-ghost btn-sm"
            title="Freeze today's plan so drift can be measured against it"
          >
            {baselining ? <Spinner /> : <Icon name="clock" size={15} />}
            {bundle.baseline_name
              ? `Re-baseline (currently ${bundle.baseline_name})`
              : "Set baseline"}
          </button>
        </div>
      ) : null}

      {/* ---- overlays ---- */}

      <Sheet
        open={addingTask !== false}
        onClose={() => setAddingTask(false)}
        title="Add a task"
        description="A piece of work, with a duration and a budget"
        size="md"
      >
        <TaskForm
          contacts={contacts}
          projectId={projectId}
          phases={bundle.phases}
          trades={trades}
          calendar={bundle.calendar}
          defaultPhaseId={typeof addingTask === "string" ? addingTask : null}
          onSaved={() => {
            setAddingTask(false);
            reload();
          }}
          onCancel={() => setAddingTask(false)}
        />
      </Sheet>

      <Sheet
        open={addingPhase || editingPhase !== null}
        onClose={() => {
          setAddingPhase(false);
          setEditingPhase(null);
        }}
        title={editingPhase ? editingPhase.name : "Add a phase"}
        description="Demo, first fix, second fix, snagging — whatever this job is made of"
        size="md"
      >
        <PhaseForm
          projectId={projectId}
          phase={editingPhase ?? undefined}
          onSaved={() => {
            setAddingPhase(false);
            setEditingPhase(null);
            reload();
          }}
          onCancel={() => {
            setAddingPhase(false);
            setEditingPhase(null);
          }}
        />
      </Sheet>

      <TaskSheet
        contacts={contacts}
        open={selected !== null}
        projectId={projectId}
        task={selected}
        cost={selected ? costByTask.get(selected.id) : undefined}
        phases={bundle.phases}
        tasks={bundle.tasks}
        dependencies={bundle.dependencies}
        revisions={bundle.revisions}
        trades={trades}
        calendar={bundle.calendar}
        baselined={selected ? baselinedTasks.has(selected.id) : false}
        onClose={() => setSelected(null)}
        onChanged={reload}
        onMove={() => {
          setShifting(selected);
          setSelected(null);
        }}
      />

      <ScenarioEditSheet
        open={scenarioTask !== null}
        task={scenarioTask}
        onClose={() => setScenarioTask(null)}
        onChange={addScenarioEdit}
      />

      <ShiftDialog
        open={shifting !== null}
        projectId={projectId}
        task={shifting}
        onClose={() => setShifting(null)}
        onApplied={reload}
      />
    </div>
  );
}

/**
 * One phase, its tasks, and its roll-up.
 *
 * Renders twice, per about.md §8: a `sm:hidden` card list and a
 * `hidden sm:block` table, from the SAME array — so a column added to one is
 * visibly missing from the other rather than silently absent on a phone.
 */
function PhaseGroup({
  phase,
  tasks,
  costByTask,
  costRow,
  collapsed,
  onToggle,
  onSelectTask,
  onEditPhase,
  onAddTask,
}: {
  phase: ProjectPhase | null;
  tasks: ScheduledTask[];
  costByTask: Map<string, TaskCostRow>;
  costRow?: { budget: number; net: number; variance: number; variance_pct: number | null };
  collapsed: boolean;
  onToggle: () => void;
  onSelectTask: (task: ScheduledTask) => void;
  onEditPhase?: () => void;
  onAddTask: () => void;
}) {
  const name = phase?.name ?? "Unphased";

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon
            name={collapsed ? "chevronRight" : "chevronDown"}
            size={16}
            className="shrink-0 text-gray-400"
          />
          <span className="truncate text-base font-bold tracking-[-0.01em] text-gray-900">
            {name}
          </span>
          <span className="tnum shrink-0 text-xs font-semibold text-gray-400">
            {tasks.length}
          </span>
        </button>
        {costRow ? <VarianceChip row={{ ...costRow }} /> : null}
        {onEditPhase ? (
          <button
            type="button"
            onClick={onEditPhase}
            aria-label={`Edit ${name}`}
            className="btn-icon h-9 min-h-0 w-9 min-w-0 text-gray-400"
          >
            <Icon name="edit" size={16} />
          </button>
        ) : null}
      </div>

      {collapsed ? null : tasks.length === 0 ? (
        <button
          type="button"
          onClick={onAddTask}
          className="w-full rounded-2xl border border-dashed border-gray-300 px-4 py-4 text-sm text-gray-500 transition active:bg-gray-50"
        >
          Nothing in {name} yet — add a task
        </button>
      ) : (
        <>
          {/* Mobile: cards. */}
          <div className="space-y-2.5 sm:hidden">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                cost={costByTask.get(task.id)}
                onSelect={() => onSelectTask(task)}
              />
            ))}
          </div>

          {/* Desktop: the same array as a table. */}
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                  <th className="pb-2.5 pr-3">Task</th>
                  <th className="pb-2.5 pr-3">Dates</th>
                  <th className="pb-2.5 pr-3">Status</th>
                  <th className="pb-2.5 pr-3 text-right">Float</th>
                  <th className="pb-2.5 pr-3 text-right">Drift</th>
                  <th
                    className="pb-2.5 pr-3 text-right"
                    title="Both ex VAT — a task budget matches the net on an invoice line"
                  >
                    {BUDGET.label} · Cost
                  </th>
                  <th className="pb-2.5 pr-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200/70">
                {tasks.map((task) => {
                  const cost = costByTask.get(task.id);
                  return (
                    <tr key={task.id} className="align-top">
                      <td className="py-2.5 pr-3">
                        <button
                          type="button"
                          onClick={() => onSelectTask(task)}
                          className="text-left font-semibold text-gray-900 hover:text-brand-700"
                        >
                          {task.name}
                        </button>
                        <span className="mt-0.5 flex flex-wrap gap-1.5">
                          {task.is_critical ? (
                            <Badge label="Critical" tone="bad" />
                          ) : null}
                          {task.is_blocked ? (
                            <Badge label="Blocked" tone="warn" />
                          ) : null}
                          {task.weather_sensitive ? (
                            <Badge label="Weather" tone="info" />
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600">
                        {fmtDate(task.computed_start)} →{" "}
                        {fmtDate(task.computed_end)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="text-gray-600">{task.status}</span>
                        <span className="tnum mt-0.5 block text-xs text-gray-400">
                          {Number(task.progress_pct)}%
                        </span>
                      </td>
                      <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                        {task.total_float === null
                          ? "—"
                          : task.total_float <= 0
                            ? "—"
                            : `+${task.total_float}d`}
                      </td>
                      <td
                        className={`tnum py-2.5 pr-3 text-right font-semibold ${
                          (task.drift_end_days ?? 0) > 0
                            ? "text-red-600"
                            : (task.drift_end_days ?? 0) < 0
                              ? "text-emerald-600"
                              : "text-gray-400"
                        }`}
                      >
                        {task.drift_end_days === null
                          ? "—"
                          : task.drift_end_days === 0
                            ? "0"
                            : `${task.drift_end_days > 0 ? "+" : ""}${task.drift_end_days}d`}
                      </td>
                      <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                        {cost && cost.budget > 0
                          ? formatCurrency(cost.budget)
                          : "—"}
                        <span className="block text-xs text-gray-400">
                          {cost ? formatCurrency(cost.net) : "—"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        {cost ? <VarianceChip row={cost} /> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function TaskCard({
  task,
  cost,
  onSelect,
}: {
  task: ScheduledTask;
  cost?: TaskCostRow;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="card block w-full text-left transition active:scale-[0.99]"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-bold text-gray-900">
            {task.name}
          </span>
          <span className="mt-0.5 block text-[0.8125rem] text-gray-500">
            {fmtDate(task.computed_start)} → {fmtDate(task.computed_end)}
          </span>
        </span>
        {cost ? <VarianceChip row={cost} /> : null}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge label={task.status} />
        {task.is_critical ? <Badge label="Critical" tone="bad" /> : null}
        {task.is_blocked ? <Badge label="Blocked" tone="warn" /> : null}
        {task.total_float !== null && task.total_float > 0 ? (
          <span className="tnum text-xs font-medium text-gray-500">
            +{task.total_float}d slack
          </span>
        ) : null}
        {task.drift_end_days !== null && task.drift_end_days !== 0 ? (
          <span
            className={`tnum text-xs font-bold ${
              task.drift_end_days > 0 ? "text-red-600" : "text-emerald-600"
            }`}
          >
            {task.drift_end_days > 0 ? "+" : ""}
            {task.drift_end_days}d vs baseline
          </span>
        ) : null}
      </div>

      {Number(task.progress_pct) > 0 ? (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-brand"
            style={{ width: `${Math.min(100, Number(task.progress_pct))}%` }}
          />
        </div>
      ) : null}

      {cost && (cost.budget > 0 || cost.net > 0) ? (
        <p className="mt-2 text-xs text-gray-500">
          {BUDGET.label} {formatCurrency(cost.budget)} · {MONEY.cost.label}{" "}
          {formatCurrency(cost.net)}{" "}
          <span className="text-gray-400">(both ex VAT)</span>
        </p>
      ) : null}
    </button>
  );
}
