"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * How many sheets are open, so Escape only closes the top one.
 *
 * Sheets genuinely nest here: the status dialog on the Costs tab is a sheet,
 * and the Select and DatePicker inside it open sheets of their own. Both
 * register a `keydown` listener on `document`, and `stopPropagation` does not
 * stop a sibling listener on the same node — so without this, one Escape closed
 * the picker *and* the form behind it, losing what had been typed.
 */
let openSheets = 0;

/**
 * The app's one overlay primitive.
 *
 * On a phone it is a bottom sheet: it rises from the bottom edge, is capped at
 * 88% of the viewport, and carries a grab handle — the gesture vocabulary
 * people already have from native apps. From `sm:` up it becomes a centred
 * dialog, because a sheet glued to the bottom of a wide screen looks lost.
 *
 * Everything modal in the app is built on this — the custom select, the date
 * picker, confirmations, and the add-menu — so overlays cannot drift apart in
 * padding, motion, dismissal or focus behaviour.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  /** Caps the sheet's width on desktop. */
  size = "md",
  /** Hides the header row entirely (menus that are self-evident). */
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  bare?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Sheets render into `document.body`, not where they are written. The panel
  // animates with a `transform`, and a transformed ancestor becomes the
  // containing block for `position: fixed` descendants — so a Select opened
  // from inside a sheet would be clipped to that sheet's box instead of
  // covering the screen. Portalling sidesteps the whole class of problem.
  // `mounted` keeps the first server render and the first client render
  // identical, which is what React's hydration check compares.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes; the page behind must not scroll while a sheet is up,
  // otherwise the background slides under your finger as you scroll the sheet.
  useEffect(() => {
    if (!open) return;

    // Claim a depth on the way in and compare against the live count: only the
    // sheet that is currently deepest reacts to Escape.
    openSheets += 1;
    const depth = openSheets;

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (depth !== openSheets) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      openSheets -= 1;
      document.removeEventListener("keydown", onKey);
      // Only the last sheet to close restores scrolling; an inner sheet closing
      // must leave the page locked for the one still open behind it.
      if (openSheets === 0) document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  // Move focus into the sheet so the keyboard and screen readers follow it.
  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    if (!node) return;
    const target = node.querySelector<HTMLElement>(
      "[data-autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    target?.focus({ preventScroll: true });
  }, [open]);

  if (!open || !mounted) return null;

  const width =
    size === "sm" ? "sm:max-w-sm" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        className="absolute inset-0 animate-fade-in bg-gray-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={`relative flex max-h-[88vh] w-full animate-sheet-up flex-col
          rounded-t-3xl bg-white shadow-pop
          sm:max-h-[85vh] sm:animate-pop-in sm:rounded-3xl ${width}`}
      >
        {/* Grab handle: signals "drag me down", and gives the thumb a target
            that is not a control. Mobile only — meaningless on a desktop modal. */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-gray-300" />
        </div>

        {!bare && (title || description) ? (
          <div className="flex items-start gap-3 px-5 pb-3 pt-3 sm:pt-5">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="text-lg font-bold tracking-[-0.01em] text-gray-900">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p className="mt-1 text-sm leading-relaxed text-gray-500">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="btn-icon -mr-2 -mt-1 text-gray-400 hover:text-gray-700"
            >
              <Icon name="close" size={20} />
            </button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          {children}
        </div>

        {footer ? (
          <div className="border-t border-gray-200/80 bg-white px-5 py-3 pb-safe sm:rounded-b-3xl">
            {footer}
          </div>
        ) : (
          <div className="pb-safe sm:hidden" />
        )}
      </div>
    </div>,
    document.body,
  );
}
