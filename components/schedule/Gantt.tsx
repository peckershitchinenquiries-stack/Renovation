"use client";

import { useMemo, useRef, useState } from "react";
import {
  addCalendarDays,
  isISODate,
  isWorkingDay,
  todayISO,
} from "@/lib/schedule";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState } from "@/components/ui/States";
import GanttBar, { ROW_HEIGHT } from "./GanttBar";
import DependencyArrows from "./DependencyArrows";
import {
  TimelineScale,
  buildTimeline,
  type Timeline,
  type Zoom,
} from "./TimelineScale";
import type {
  ProjectPhase,
  ScheduleResult,
  ScheduledTask,
  TaskBaseline,
  TaskDependency,
  WorkCalendar,
} from "@/types";

/**
 * The chart.
 *
 * Built in-house rather than with a Gantt library, for reasons that are worth
 * restating where the code is:
 *
 *   * The scheduling maths already lives in `lib/schedule.ts`, because the
 *     critical path and the float are needed by screens that are not charts. A
 *     library brings its own engine, and then there are two, and they disagree.
 *   * This app is used almost entirely on phones. Every mature Gantt library is
 *     a desktop, mouse-first, dense-grid control; making one work at 375px is
 *     not obviously less work than drawing rectangles.
 *   * Inline cost-impact-on-drag is a custom render on the bar in every case.
 *
 * Layout: a sticky task column on the left, a horizontally scrolling timeline
 * on the right, one shared vertical scroll. Phases are bands; a collapsed phase
 * hides its rows AND its arrows, rather than drawing links to nothing.
 */

const NAME_WIDTH = 168;

interface Row {
  kind: "phase" | "task";
  key: string;
  phase?: ProjectPhase;
  task?: ScheduledTask;
  colour: ProjectPhase["colour"];
}

export default function Gantt({
  schedule,
  phases,
  dependencies,
  baseline,
  calendar,
  selectedId,
  onSelect,
  onShift,
}: {
  schedule: ScheduleResult;
  phases: ProjectPhase[];
  dependencies: TaskDependency[];
  baseline: TaskBaseline[];
  calendar: WorkCalendar;
  selectedId: string | null;
  onSelect: (task: ScheduledTask) => void;
  /** A finished desktop drag. Opens the preview; saves nothing itself. */
  onShift: (task: ScheduledTask, days: number, edge: "move" | "start" | "end") => void;
}) {
  // A week viewport by default: a month of a domestic renovation fits on a
  // laptop and scrolls comfortably on a phone. Day zoom is for the week you
  // are actually working in.
  const [zoom, setZoom] = useState<Zoom>("week");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = todayISO();

  const dated = schedule.tasks.filter(
    (t) => isISODate(t.computed_start) && isISODate(t.computed_end)
  );

  const timeline = useMemo(() => {
    if (dated.length === 0)
      return buildTimeline(today, addCalendarDays(today, 30), zoom);
    const starts = dated.map((t) => t.computed_start!).sort();
    const ends = dated.map((t) => t.computed_end!).sort();
    // Today is always in view, so "we are here" is never off the end of the
    // chart on a job that finished last month.
    const from = [starts[0], today].sort()[0];
    const to = [ends[ends.length - 1], today].sort().reverse()[0];
    return buildTimeline(from, to, zoom);
  }, [dated, zoom, today]);

  // Rows, in phase order, with the unphased work last. Building this list once
  // is what lets the arrows know which visual row each task is on.
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const byPhase = new Map<string, ScheduledTask[]>();
    for (const task of schedule.tasks) {
      const key = task.phase_id ?? "__unphased";
      const list = byPhase.get(key) ?? [];
      list.push(task);
      byPhase.set(key, list);
    }
    for (const phase of phases) {
      const list = byPhase.get(phase.id) ?? [];
      if (list.length === 0) continue;
      out.push({ kind: "phase", key: `p:${phase.id}`, phase, colour: phase.colour });
      if (!collapsed.has(phase.id))
        for (const task of list)
          out.push({ kind: "task", key: task.id, task, colour: phase.colour });
    }
    const loose = byPhase.get("__unphased") ?? [];
    if (loose.length > 0) {
      out.push({
        kind: "phase",
        key: "p:__unphased",
        phase: {
          id: "__unphased",
          name: "Unphased",
        } as ProjectPhase,
        colour: null,
      });
      if (!collapsed.has("__unphased"))
        for (const task of loose)
          out.push({ kind: "task", key: task.id, task, colour: null });
    }
    return out;
  }, [schedule.tasks, phases, collapsed]);

  const rowIndex = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => {
      if (row.kind === "task" && row.task) map.set(row.task.id, i);
    });
    return map;
  }, [rows]);

  const baselineByTask = useMemo(
    () => new Map(baseline.map((b) => [b.task_id, b])),
    [baseline]
  );
  const criticalIds = useMemo(
    () => new Set(schedule.critical_task_ids),
    [schedule.critical_task_ids]
  );

  function toggle(phaseId: string) {
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }

  if (schedule.tasks.length === 0)
    return (
      <EmptyState
        icon="chart"
        title="Nothing to chart yet"
        description="Add some tasks with dates and they will appear here."
      />
    );

  const gridHeight = rows.length * ROW_HEIGHT;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          label="Timeline zoom"
          value={zoom}
          onChange={setZoom}
          options={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollLeft = Math.max(0, timeline.x(today) - 120);
          }}
        >
          Today
        </button>
      </div>

      <div className="card-flush">
        <div className="flex">
          {/* The task column. Sticky by being outside the scroller entirely,
              which is simpler and steadier than position: sticky over a
              horizontally scrolling grid. */}
          <div
            className="shrink-0 border-r border-gray-200"
            style={{ width: NAME_WIDTH }}
          >
            <div className="h-9 border-b border-gray-200" />
            {rows.map((row) => (
              <div
                key={row.key}
                className={`flex items-center gap-1.5 truncate px-2.5 text-2xs ${
                  row.kind === "phase"
                    ? "bg-gray-50 font-bold uppercase tracking-wider text-gray-500"
                    : ""
                }`}
                style={{ height: ROW_HEIGHT }}
              >
                {row.kind === "phase" && row.phase ? (
                  <button
                    type="button"
                    onClick={() => toggle(row.phase!.id)}
                    aria-expanded={!collapsed.has(row.phase.id)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {collapsed.has(row.phase.id) ? "▸" : "▾"} {row.phase.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => row.task && onSelect(row.task)}
                    className={`min-w-0 flex-1 truncate text-left text-[0.8125rem] ${
                      selectedId === row.task?.id
                        ? "font-bold text-gray-900"
                        : "text-gray-700"
                    }`}
                  >
                    {row.task?.name}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* The timeline. Scrolls horizontally on its own; the header scrolls
              with it because it is inside the same box. */}
          <div ref={scrollRef} className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ width: timeline.width }}>
              <TimelineScale timeline={timeline} zoom={zoom} today={today} />

              <div className="relative" style={{ height: gridHeight }}>
                {/* Non-working days, shaded, so a bar that appears to span
                    seven days is visibly only five days of work. Skipped at
                    month zoom, where four-pixel stripes are just noise. */}
                {zoom !== "month" ? (
                  <NonWorkingDays
                    timeline={timeline}
                    height={gridHeight}
                    calendar={calendar}
                  />
                ) : null}

                <div
                  className="absolute top-0 h-full w-px bg-red-500/70"
                  style={{ left: timeline.x(today) }}
                  aria-hidden
                />

                {rows.map((row, i) => (
                  <div
                    key={row.key}
                    className={`absolute inset-x-0 ${
                      row.kind === "phase" ? "bg-gray-50" : ""
                    }`}
                    style={{ top: i * ROW_HEIGHT, height: ROW_HEIGHT }}
                  >
                    {row.kind === "task" && row.task ? (
                      <GanttBar
                        task={row.task}
                        baseline={baselineByTask.get(row.task.id)}
                        timeline={timeline}
                        colour={row.colour}
                        selected={selectedId === row.task.id}
                        onSelect={() => onSelect(row.task!)}
                        onDrag={(days, edge) => onShift(row.task!, days, edge)}
                      />
                    ) : null}
                  </div>
                ))}

                <DependencyArrows
                  dependencies={dependencies}
                  tasks={schedule.tasks}
                  rowIndex={rowIndex}
                  timeline={timeline}
                  criticalIds={criticalIds}
                  height={gridHeight}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="hint">
        Red bars drive the completion date. The grey line under a bar is where
        the baseline put it. On a phone, tap a bar to move it — dragging fights
        the scroll.
      </p>
    </div>
  );
}

/**
 * Weekend and holiday shading.
 *
 * Drawn as one absolutely-positioned strip per non-working day. At day and
 * week zoom that is a few dozen elements over a typical renovation, which is
 * nothing; a canvas or a repeating gradient would be faster and much harder to
 * keep aligned with the day grid the bars use.
 */
function NonWorkingDays({
  timeline,
  height,
  calendar,
}: {
  timeline: Timeline;
  height: number;
  calendar: WorkCalendar;
}) {
  const strips: string[] = [];
  for (let i = 0; i < timeline.days; i += 1) {
    const iso = addCalendarDays(timeline.start, i);
    // The project's own calendar, not a hard-coded Mon–Fri: a job that runs
    // Saturdays must not have every Saturday shaded as if it were idle.
    if (!isWorkingDay(iso, calendar)) strips.push(iso);
  }
  return (
    <>
      {strips.map((iso) => (
        <div
          key={iso}
          className="absolute top-0 bg-gray-100/70"
          style={{ left: timeline.x(iso), width: timeline.dayWidth, height }}
          aria-hidden
        />
      ))}
    </>
  );
}
