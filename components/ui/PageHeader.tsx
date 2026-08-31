import React from "react";
import Link from "next/link";
import { Icon } from "./Icon";

/**
 * The sticky bar at the top of every screen.
 *
 * One header component for the whole app is what makes the pages feel like one
 * application: the title always sits in the same place, the back affordance is
 * always in the same corner, and the actions are always on the right.
 *
 * `backHref` is a real route rather than `history.back()` on purpose — an
 * explicit parent means the arrow does the same thing whether the screen was
 * reached from a list, a link in an email, or a refresh.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel = "Back",
  action,
  /** Rendered full-width under the title — search fields, segmented pivots. */
  below,
  /** Blends the header into the page instead of drawing a bottom rule. */
  flush = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  backHref?: string;
  backLabel?: string;
  action?: React.ReactNode;
  below?: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <header
      // `sm:top-12` clears the desktop TopNav, which is itself sticky at the
      // top of the viewport; `z-20` keeps this *under* that bar (z-30) so the
      // two never render on top of each other. On mobile there is no top bar,
      // so this is the thing pinned to the top edge.
      className={`sticky top-0 z-20 -mx-3 mb-4 bg-gray-50/85 px-3 pb-3 pt-3
        backdrop-blur-xl sm:-mx-4 sm:top-12 sm:px-4
        ${flush ? "" : "border-b border-gray-200/70"}`}
    >
      <div className="flex items-start gap-2">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="btn-icon -ml-2 mt-0.5 text-gray-700"
          >
            <Icon name="chevronLeft" size={22} strokeWidth={2} />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="page-title truncate">{title}</h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-[0.8125rem] text-gray-500">
              {subtitle}
            </p>
          ) : null}
        </div>

        {action ? (
          <div className="flex shrink-0 items-center gap-1.5">{action}</div>
        ) : null}
      </div>

      {below ? <div className="mt-3">{below}</div> : null}
    </header>
  );
}

/**
 * A quieter heading for a group *inside* a page, with an optional action on the
 * right. Keeps section headings from being re-invented on every screen.
 */
export function SectionHeader({
  title,
  hint,
  action,
  className = "",
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-2.5 flex items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="section-title">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-gray-500">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
