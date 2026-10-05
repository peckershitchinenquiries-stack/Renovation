"use client";

import { Icon } from "./Icon";

/**
 * The app's search field.
 *
 * Search existed on exactly two screens — the Costs tab and the Analysis tab —
 * and each had written its own copy of the same four things: the magnifier
 * inside the left padding, an `sr-only` label, the `×` that clears it, and the
 * `pl-10 pr-10` that makes room for both. Two copies had already drifted: the
 * Analysis one positioned its `×` with a hand-measured `sm:left-[19rem]`
 * against a field capped at 24rem, which put the button five rem inside the
 * field's right edge at desktop width.
 *
 * So: one component. Everything that needs search uses it, and the next screen
 * to want one does not get a vote on where the `×` goes.
 *
 * It is deliberately uncontrolled in nothing — `value` in, `onChange(value)`
 * out, exactly like `Select` and `DatePicker` — because every caller already
 * holds the query in state to filter with it, and a component that owned the
 * value would have to hand it back out anyway.
 *
 * `id` is required rather than defaulted. Two search boxes on one screen with
 * the same generated id would silently break both labels, and there is no safe
 * guess to make.
 */
export function SearchInput({
  id,
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
  /** Caps the field's width from `sm` up. The wrapper carries it, not the
   *  input: the magnifier and the `×` are positioned against the wrapper, so a
   *  cap on the input alone leaves them floating beside a narrower field. */
  className = "",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The `sr-only` label. Say what is being searched when it is not obvious. */
  label?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <Icon
        name="search"
        size={18}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
      />
      <input
        id={id}
        // Not `type="search"`: WebKit draws its own clear button inside that
        // one, which would sit on top of ours. Both the implementations this
        // replaces were plain text inputs.
        className="input pl-10 pr-10"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="btn-icon absolute right-1 top-1/2 h-9 min-h-0 w-9 min-w-0 -translate-y-1/2 text-gray-400"
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}
