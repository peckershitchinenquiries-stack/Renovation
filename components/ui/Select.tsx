"use client";

import React, { useMemo, useState } from "react";
import { Icon } from "./Icon";
import { Sheet } from "./Sheet";

export interface SelectOption {
  value: string;
  label: string;
  /** Secondary line under the label — a price, a count, a disambiguator. */
  hint?: string;
  disabled?: boolean;
}

/**
 * The app's dropdown. Replaces every native `<select>`.
 *
 * A native select on a phone hands the choice to the OS: a grey wheel on iOS,
 * a grey list on Android, in a system font, with no room for the second line of
 * context ("£120 · last used 3 Jun") that most of these choices actually need.
 * This one opens the app's own bottom sheet, so a choice looks and behaves the
 * same on every device, and gains search once the list is long enough to need it.
 *
 * The API is deliberately the same shape as the `<select>` it replaced —
 * `value` in, `onChange(value)` out — so swapping one for the other is a
 * one-line change at each call site and no form logic moves.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  id,
  disabled = false,
  invalid = false,
  /** Adds a "Clear" row that emits "". */
  clearable = false,
  /** Shows a search box; defaults to on once the list passes 8 options. */
  searchable,
  title,
  className = "",
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  clearable?: boolean;
  searchable?: boolean;
  /** Heading on the sheet. Falls back to the placeholder. */
  title?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = options.find((o) => o.value === value);
  const showSearch = searchable ?? options.length > 8;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint ?? "").toLowerCase().includes(q),
    );
  }, [options, query]);

  function choose(next: string) {
    onChange(next);
    setOpen(false);
    setQuery("");
  }

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        className={`input flex items-center justify-between gap-2 text-left
          ${selected ? "text-gray-900" : "text-gray-400"}
          ${invalid ? "input-invalid" : ""} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? placeholder}
        </span>
        <Icon name="chevronDown" size={18} className="text-gray-400" />
      </button>

      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setQuery("");
        }}
        title={title ?? placeholder}
        size="sm"
      >
        {showSearch ? (
          <div className="sticky top-0 -mx-5 mb-1 bg-white px-5 pb-2">
            <div className="relative">
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                data-autofocus
                className="input pl-10"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        <ul role="listbox" className="-mx-2">
          {clearable ? (
            <OptionRow
              label="None"
              selected={value === ""}
              muted
              onSelect={() => choose("")}
            />
          ) : null}

          {visible.map((o) => (
            <OptionRow
              key={o.value}
              label={o.label}
              hint={o.hint}
              disabled={o.disabled}
              selected={o.value === value}
              onSelect={() => choose(o.value)}
            />
          ))}

          {visible.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-gray-500">
              Nothing matches “{query}”.
            </li>
          ) : null}
        </ul>
      </Sheet>
    </>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  disabled,
  muted,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  disabled?: boolean;
  muted?: boolean;
  onSelect: () => void;
}) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className={`flex min-h-touch w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition
          active:bg-gray-100 disabled:opacity-40
          ${selected ? "bg-brand-50" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[0.9375rem] ${
              selected
                ? "font-semibold text-brand-800"
                : muted
                  ? "text-gray-500"
                  : "font-medium text-gray-900"
            }`}
          >
            {label}
          </span>
          {hint ? (
            <span className="mt-0.5 block truncate text-xs text-gray-500">
              {hint}
            </span>
          ) : null}
        </span>
        {selected ? (
          <Icon name="check" size={18} className="text-brand-700" strokeWidth={2.25} />
        ) : null}
      </button>
    </li>
  );
}
