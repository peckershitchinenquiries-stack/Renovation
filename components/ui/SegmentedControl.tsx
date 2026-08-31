"use client";

/**
 * A pivot control: one dataset, several ways of grouping it.
 *
 * Used where a set of screens turned out to be the same screen. The segment
 * label is the whole explanation of what the table below shows, which is why
 * the paragraph that used to sit above each of those tables is gone — prose
 * above a table is a sign the table's placement is not self-evident, and a
 * label the reader chose themselves a moment ago is self-evident.
 *
 * It scrolls horizontally rather than wrapping: a control that changes height
 * when you pick a different segment shifts the whole page under the reader's
 * thumb, which is worse than a strip they can nudge sideways.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  /** Stretches segments to fill the width — for 2–3 options. */
  fill = false,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  /** Accessible name for the group — never rendered. */
  label: string;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`no-scrollbar ${fill ? "flex" : "inline-flex"} max-w-full
        gap-0.5 overflow-x-auto rounded-2xl bg-gray-100 p-1 ${className}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`h-9 whitespace-nowrap rounded-xl px-3.5 text-[0.8125rem]
              font-semibold transition-all duration-150 active:scale-[0.97]
              ${fill ? "flex-1" : ""}
              ${
                active
                  ? "bg-white text-gray-900 shadow-card"
                  : "text-gray-500 hover:text-gray-800"
              }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Filter chips — a scrolling row of independent toggles.
 * Distinct from the segmented control: that picks exactly one of a set, this
 * narrows a list and can be cleared back to "everything".
 */
export function ChipRow<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 sm:-mx-4 sm:px-4"
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5
              text-[0.8125rem] font-semibold transition active:scale-95
              ${
                active
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
              }`}
          >
            {o.label}
            {typeof o.count === "number" ? (
              <span
                className={`tnum text-xs font-bold ${
                  active ? "text-white/60" : "text-gray-400"
                }`}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
