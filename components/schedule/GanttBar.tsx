"use client";

import { useRef, useState } from "react";
import { isISODate } from "@/lib/schedule";
import type { Timeline } from "./TimelineScale";
import type { PhaseColour, ScheduledTask, TaskBaseline } from "@/types";

/**
 * One bar.
 *
 * Four things are drawn, in this order back to front:
 *
 *   1. the **baseline ghost** — where the plan originally said this task went,
 *      so drift is visible without reading a number
 *   2. the **bar** — its phase colour, or red when it is on the critical path
 *   3. the **progress fill** — how much of it is done
 *   4. the **drag handles** — desktop only; see the note on touch below
 *
 * **Touch does not drag.** A bar is fourteen pixels tall and a thumb is not
 * precise; worse, a horizontal drag on a scrolling chart fights the page. On a
 * phone a bar is a button that opens the shift sheet, which reaches the same
 * API with the same preview. The desktop gets the drag because a mouse can
 * hit a three-pixel handle. Both confirm before anything is written.
 */

const COLOURS: Record<PhaseColour, string> = {
  slate: "bg-slate-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  violet: "bg-violet-500",
  rose: "bg-rose-500",
  teal: "bg-teal-500",
  orange: "bg-orange-500",
};

export const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;

export default function GanttBar({
  task,
  baseline,
  timeline,
  colour,
  selected,
  onSelect,
  onDrag,
}: {
  task: ScheduledTask;
  baseline?: TaskBaseline;
  timeline: Timeline;
  colour: PhaseColour | null;
  selected: boolean;
  onSelect: () => void;
  /**
   * Desktop drag finished. `days` is the calendar-day offset; `edge` says
   * whether the whole bar moved or one end was pulled. Nothing is saved by
   * this callback — it opens the preview.
   */
  onDrag?: (days: number, edge: "move" | "start" | "end") => void;
}) {
  const [drag, setDrag] = useState<{ edge: "move" | "start" | "end"; dx: number } | null>(
    null
  );
  const originX = useRef(0);

  if (!isISODate(task.computed_start) || !isISODate(task.computed_end)) return null;

  const left = timeline.x(task.computed_start);
  const width = timeline.span(task.computed_start, task.computed_end);
  const progress = Math.min(100, Math.max(0, Number(task.progress_pct) || 0));

  // Live geometry while dragging, so the bar follows the mouse before any
  // request is made. Nothing here touches the task.
  const dx = drag?.dx ?? 0;
  const shownLeft = drag?.edge === "end" ? left : left + dx;
  const shownWidth =
    drag?.edge === "end"
      ? Math.max(timeline.dayWidth, width + dx)
      : drag?.edge === "start"
        ? Math.max(timeline.dayWidth, width - dx)
        : width;

  function startDrag(edge: "move" | "start" | "end", e: React.PointerEvent) {
    if (!onDrag) return;
    // Only a mouse drags. A touch pointer is left alone so the chart scrolls.
    if (e.pointerType === "touch") return;
    e.preventDefault();
    e.stopPropagation();
    originX.current = e.clientX;
    setDrag({ edge, dx: 0 });
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      // Snap to whole days: a bar cannot start at half past Tuesday.
      const raw = ev.clientX - originX.current;
      const snapped =
        Math.round(raw / timeline.dayWidth) * timeline.dayWidth;
      setDrag({ edge, dx: snapped });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const days = Math.round((ev.clientX - originX.current) / timeline.dayWidth);
      setDrag(null);
      if (days !== 0) onDrag(days, edge);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const barColour = task.is_critical
    ? "bg-red-500"
    : colour
      ? COLOURS[colour]
      : "bg-brand";

  return (
    <div className="absolute inset-x-0" style={{ height: ROW_HEIGHT }}>
      {/* Baseline ghost — where this task was originally promised. */}
      {baseline &&
      isISODate(baseline.planned_start) &&
      isISODate(baseline.planned_end) ? (
        <div
          className="absolute rounded-full bg-gray-300/60"
          style={{
            left: timeline.x(baseline.planned_start),
            width: timeline.span(baseline.planned_start, baseline.planned_end),
            height: 4,
            top: (ROW_HEIGHT - BAR_HEIGHT) / 2 + BAR_HEIGHT + 1,
          }}
          aria-hidden
        />
      ) : null}

      <button
        type="button"
        onClick={onSelect}
        onPointerDown={(e) => startDrag("move", e)}
        title={`${task.name} · ${task.computed_start} → ${task.computed_end}${
          task.is_critical ? " · critical" : ""
        }`}
        aria-label={`${task.name}, ${task.computed_start} to ${task.computed_end}`}
        className={`absolute overflow-hidden rounded-md text-left transition-shadow
          ${barColour}
          ${selected ? "ring-2 ring-gray-900 ring-offset-1" : ""}
          ${onDrag ? "sm:cursor-grab" : ""}`}
        style={{
          left: shownLeft,
          width: shownWidth,
          height: BAR_HEIGHT,
          top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
        }}
      >
        {/* Progress. Deliberately a lighter overlay rather than a second bar:
            two bars in one row reads as two tasks. */}
        {progress > 0 ? (
          <span
            className="absolute inset-y-0 left-0 bg-white/35"
            style={{ width: `${progress}%` }}
            aria-hidden
          />
        ) : null}
        {/* The name rides on the bar once there is room for it. */}
        {shownWidth > 60 ? (
          <span className="relative ml-1.5 block truncate text-2xs font-semibold leading-4 text-white">
            {task.name}
          </span>
        ) : null}
      </button>

      {/* Resize handles. Mouse only, and invisible until the row is hovered —
          they are three pixels of target and a permanent pair of them on every
          row is visual noise. */}
      {onDrag ? (
        <>
          <span
            role="presentation"
            onPointerDown={(e) => startDrag("start", e)}
            className="absolute hidden w-1.5 cursor-ew-resize rounded-l bg-white/0 hover:bg-white/60 sm:block"
            style={{
              left: shownLeft,
              width: 6,
              height: BAR_HEIGHT,
              top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
            }}
          />
          <span
            role="presentation"
            onPointerDown={(e) => startDrag("end", e)}
            className="absolute hidden w-1.5 cursor-ew-resize rounded-r bg-white/0 hover:bg-white/60 sm:block"
            style={{
              left: shownLeft + shownWidth - 6,
              width: 6,
              height: BAR_HEIGHT,
              top: (ROW_HEIGHT - BAR_HEIGHT) / 2,
            }}
          />
        </>
      ) : null}

      {/* Order-by marker: when this has to be ordered to arrive on time. */}
      {task.lead_time_days && task.lead_time_days > 0 ? (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 rotate-45 border border-amber-600 bg-amber-300"
          style={{
            left: left - task.lead_time_days * timeline.dayWidth,
            top: ROW_HEIGHT / 2 - 4,
          }}
          title={`Order ${task.lead_time_days} days before it starts`}
          aria-hidden
        />
      ) : null}
    </div>
  );
}
