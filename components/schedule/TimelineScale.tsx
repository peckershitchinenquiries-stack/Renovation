"use client";

import { addCalendarDays, isoWeekday, toDayNumber } from "@/lib/schedule";

/**
 * The timeline geometry, shared by the chart and its arrows.
 *
 * One module owns the day→pixel mapping so a bar, a header tick and a
 * dependency arrow cannot each compute it slightly differently. Everything is
 * in CALENDAR days: the chart draws real time, and a weekend a task spans is
 * space on the page even though it is not work. (The engine's arithmetic is in
 * working days; that difference is exactly why the two are kept apart.)
 */

export type Zoom = "day" | "week" | "month";

/** Pixels per calendar day at each zoom. Tuned so a bar stays tappable. */
export const DAY_WIDTH: Record<Zoom, number> = {
  day: 34,
  week: 12,
  month: 4,
};

export interface Timeline {
  start: string;
  end: string;
  days: number;
  dayWidth: number;
  width: number;
  x: (iso: string) => number;
  /** Width in pixels of an inclusive span, never less than 3px so it is visible. */
  span: (from: string, to: string) => number;
}

export function buildTimeline(
  from: string,
  to: string,
  zoom: Zoom,
  padDays = 3
): Timeline {
  const start = addCalendarDays(from, -padDays);
  const end = addCalendarDays(to, padDays);
  const days = Math.max(1, toDayNumber(end) - toDayNumber(start) + 1);
  const dayWidth = DAY_WIDTH[zoom];
  const origin = toDayNumber(start);

  const x = (iso: string) => (toDayNumber(iso) - origin) * dayWidth;

  return {
    start,
    end,
    days,
    dayWidth,
    width: days * dayWidth,
    x,
    span: (a: string, b: string) =>
      Math.max(3, (toDayNumber(b) - toDayNumber(a) + 1) * dayWidth),
  };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The header row: month bands above, day or week ticks below.
 *
 * At `month` zoom the ticks are months and the day row disappears — four
 * pixels a day cannot carry a number, and a header of overlapping digits is
 * worse than no header.
 */
export function TimelineScale({
  timeline,
  zoom,
  today,
}: {
  timeline: Timeline;
  zoom: Zoom;
  today: string;
}) {
  const ticks: { iso: string; label: string; major: boolean }[] = [];
  for (let i = 0; i < timeline.days; i += 1) {
    const iso = addCalendarDays(timeline.start, i);
    const [, m, d] = iso.split("-");
    const day = Number(d);
    if (zoom === "day") {
      ticks.push({ iso, label: String(day), major: day === 1 });
    } else if (zoom === "week") {
      // One tick a week, on the Monday, so the row reads as weeks.
      if (isoWeekday(iso) === 1)
        ticks.push({ iso, label: `${day} ${MONTHS[Number(m) - 1]}`, major: day <= 7 });
    } else if (day === 1) {
      ticks.push({ iso, label: MONTHS[Number(m) - 1], major: true });
    }
  }

  return (
    <div
      className="relative h-9 border-b border-gray-200"
      style={{ width: timeline.width }}
    >
      {ticks.map((tick) => (
        <div
          key={tick.iso}
          className={`absolute top-0 h-full ${
            tick.major ? "border-l border-gray-300" : "border-l border-gray-100"
          }`}
          style={{ left: timeline.x(tick.iso) }}
        >
          <span
            className={`ml-1 whitespace-nowrap text-2xs leading-9 ${
              tick.major ? "font-bold text-gray-600" : "text-gray-400"
            }`}
          >
            {tick.label}
          </span>
        </div>
      ))}
      {/* Today. The one line on the chart that is not about the plan. */}
      <div
        className="absolute top-0 h-full w-px bg-red-500"
        style={{ left: timeline.x(today) }}
        aria-hidden
      />
    </div>
  );
}
