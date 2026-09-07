"use client";

import { isISODate } from "@/lib/schedule";
import { ROW_HEIGHT } from "./GanttBar";
import type { Timeline } from "./TimelineScale";
import type { ScheduledTask, TaskDependency } from "@/types";

/**
 * The links between bars, as one SVG laid over the whole grid.
 *
 * One SVG rather than one per arrow: an arrow crosses rows by definition, so a
 * per-row element would be clipped by its own row. It is `pointer-events-none`
 * throughout — an arrow that swallows a click on the bar underneath it is a
 * bug nobody diagnoses quickly.
 *
 * Elbow connectors rather than curves. A curve between two bars three rows
 * apart is prettier and genuinely harder to follow; a right angle says
 * "across, down, in" and the eye tracks it.
 *
 * Only links whose BOTH ends are visible in the given row order are drawn. A
 * collapsed phase therefore hides its arrows rather than drawing them to
 * nowhere.
 */
export default function DependencyArrows({
  dependencies,
  tasks,
  rowIndex,
  timeline,
  criticalIds,
  height,
}: {
  dependencies: TaskDependency[];
  tasks: ScheduledTask[];
  /** Which visual row each task occupies, by task id. Missing = not rendered. */
  rowIndex: Map<string, number>;
  timeline: Timeline;
  criticalIds: Set<string>;
  height: number;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));

  const paths: { d: string; critical: boolean; key: string }[] = [];

  for (const dep of dependencies) {
    const from = byId.get(dep.predecessor_id);
    const to = byId.get(dep.successor_id);
    const fromRow = rowIndex.get(dep.predecessor_id);
    const toRow = rowIndex.get(dep.successor_id);
    if (!from || !to || fromRow === undefined || toRow === undefined) continue;
    if (!isISODate(from.computed_end) || !isISODate(to.computed_start)) continue;

    // Which edge of each bar the link actually leaves from and arrives at —
    // an SS link runs start-to-start, and drawing it finish-to-start would
    // misrepresent the constraint that is holding the schedule together.
    const leavesFinish = dep.dep_type === "FS" || dep.dep_type === "FF";
    const arrivesStart = dep.dep_type === "FS" || dep.dep_type === "SS";

    const fromX = leavesFinish
      ? timeline.x(from.computed_end) +
        timeline.span(from.computed_start!, from.computed_end)
      : timeline.x(from.computed_start!);
    const toX = arrivesStart
      ? timeline.x(to.computed_start)
      : timeline.x(to.computed_end!) +
        timeline.span(to.computed_start, to.computed_end!);

    const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
    const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

    // Out of the predecessor, down (or up), then into the successor. The
    // 8px stubs keep the corner off the bar's own edge.
    const stub = 8;
    const midX = Math.max(fromX + stub, toX - stub);
    const d = `M ${fromX} ${y1} H ${midX} V ${y2} H ${toX}`;

    paths.push({
      d,
      // A link is emphasised when BOTH ends drive the completion date. That is
      // the chain the reader is looking for.
      critical: criticalIds.has(from.id) && criticalIds.has(to.id),
      key: dep.id,
    });
  }

  if (paths.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0"
      width={timeline.width}
      height={height}
      aria-hidden
    >
      <defs>
        <marker
          id="gantt-arrow"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" className="fill-gray-400" />
        </marker>
        <marker
          id="gantt-arrow-critical"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" className="fill-red-500" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path
          key={p.key}
          d={p.d}
          fill="none"
          strokeWidth={p.critical ? 1.75 : 1.25}
          className={p.critical ? "stroke-red-500" : "stroke-gray-400"}
          markerEnd={`url(#${p.critical ? "gantt-arrow-critical" : "gantt-arrow"})`}
        />
      ))}
    </svg>
  );
}
