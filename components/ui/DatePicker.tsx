"use client";

import React, { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

/**
 * The app's date field. Replaces every `<input type="date">`.
 *
 * The native control is the worst offender on mobile: iOS shows a spinning
 * wheel, Android a themed dialog, and neither matches anything else on screen —
 * and neither can offer the "Today" / "Yesterday" shortcuts that account for
 * most of the dates entered here, since expenses are almost always logged the
 * day they happen.
 *
 * Values are ISO `yyyy-mm-dd` strings in and out — exactly what the native
 * input emitted and what the API already expects — so no calling code changes
 * its data handling.
 */

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Local-time ISO date. `toISOString()` would shift the day for UK evenings. */
function toISO(d: Date) {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseISO(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Fri 27 Jun 2025" — the format used everywhere a date is displayed. */
export function formatDisplayDate(value: string) {
  const d = parseISO(value);
  if (!d) return value;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "Pick a date",
  disabled = false,
  invalid = false,
  /** Adds a "Clear" action — for optional dates such as Paid Date. */
  clearable = true,
  title = "Choose a date",
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : null;

  // The month on display. Opens on the selected date, or today when empty.
  const [cursor, setCursor] = useState(() => selected ?? new Date());

  function openSheet() {
    setCursor(selected ?? new Date());
    setOpen(true);
  }

  function pick(d: Date) {
    onChange(toISO(d));
    setOpen(false);
  }

  const today = new Date();
  const todayISO = toISO(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // A 6×7 grid starting on the Monday of the week containing the 1st, so the
  // calendar never changes height as you page through months.
  const days = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [cursor]);

  function shiftMonth(delta: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  }

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={openSheet}
        className={`input flex items-center gap-2.5 text-left
          ${value ? "text-gray-900" : "text-gray-400"}
          ${invalid ? "input-invalid" : ""} ${className}`}
      >
        <Icon name="calendar" size={18} className="shrink-0 text-gray-400" />
        <span className="min-w-0 flex-1 truncate">
          {value ? formatDisplayDate(value) : placeholder}
        </span>
        {value && clearable ? (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="btn-icon -mr-1.5 h-8 min-h-0 w-8 min-w-0 text-gray-400"
          >
            <Icon name="close" size={15} />
          </span>
        ) : null}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={title} size="sm">
        {/* Shortcuts first: most dates entered in this app are today's. */}
        <div className="mb-4 flex gap-2">
          <QuickDate label="Today" onClick={() => pick(today)} active={value === todayISO} />
          <QuickDate
            label="Yesterday"
            onClick={() => pick(yesterday)}
            active={value === toISO(yesterday)}
          />
          {clearable && value ? (
            <QuickDate
              label="Clear"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            />
          ) : null}
        </div>

        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
            className="btn-icon hover:bg-gray-100"
          >
            <Icon name="chevronLeft" size={20} />
          </button>
          <p className="text-[0.9375rem] font-bold text-gray-900">
            {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
          </p>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            aria-label="Next month"
            className="btn-icon hover:bg-gray-100"
          >
            <Icon name="chevronRight" size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w, i) => (
            <div
              key={i}
              className="pb-1 text-center text-2xs font-bold uppercase text-gray-400"
            >
              {w}
            </div>
          ))}

          {days.map((d) => {
            const iso = toISO(d);
            const outside = d.getMonth() !== cursor.getMonth();
            const isSelected = iso === value;
            const isToday = iso === todayISO;
            return (
              <button
                key={iso}
                type="button"
                onClick={() => pick(d)}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isSelected}
                className={`flex h-11 items-center justify-center rounded-xl text-sm tabular-nums transition
                  active:scale-95
                  ${
                    isSelected
                      ? "bg-brand font-bold text-white shadow-sm"
                      : outside
                        ? "text-gray-300 hover:bg-gray-50"
                        : isToday
                          ? "bg-brand-50 font-bold text-brand-800"
                          : "font-medium text-gray-700 hover:bg-gray-100"
                  }`}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}

function QuickDate({
  label,
  onClick,
  active,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-9 flex-1 rounded-xl text-[0.8125rem] font-semibold transition active:scale-95 ${
        active
          ? "bg-brand text-white"
          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
