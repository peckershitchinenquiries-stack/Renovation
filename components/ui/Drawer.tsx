"use client";

import React, { useEffect } from "react";
import { Icon } from "./Icon";

/**
 * Full-screen panel on mobile, slide-over on desktop.
 *
 * Used for the long forms (add expense, edit purchase) that are too tall to be
 * a bottom sheet. On a phone it takes the whole screen and gets its own header
 * with a close control on the left, the way a pushed screen in a native app
 * does — so a form never appears to float over a page it might lose.
 */
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /** Sticky action bar pinned to the bottom edge. */
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 animate-fade-in bg-gray-950/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute inset-0 flex animate-sheet-up flex-col bg-gray-50 shadow-pop
          sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[680px] sm:max-w-full sm:animate-none"
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200/80 bg-white/90 px-2 py-2.5 pt-safe backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            className="btn-icon text-gray-700"
            aria-label="Close"
          >
            <Icon name="close" size={22} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[0.9375rem] font-bold tracking-[-0.01em] text-gray-900">
              {title}
            </h2>
            {subtitle ? (
              <p className="truncate text-xs text-gray-500">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
          {children}
        </div>

        {footer ? (
          <div className="border-t border-gray-200/80 bg-white px-4 py-3 pb-safe">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
