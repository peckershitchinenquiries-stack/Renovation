import React from "react";
import { Icon, type IconName } from "./Icon";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-gray-200/80 ${className}`} />;
}

export function CardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="mt-2.5 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/**
 * Placeholder for the sticky `PageHeader` every screen now opens with.
 *
 * Loading files have to mirror the real layout closely or the page visibly
 * jumps when the data lands — which on a phone means the thing you were about
 * to tap moves out from under your thumb.
 */
export function HeaderSkeleton({ below = false }: { below?: boolean }) {
  return (
    <div className="mb-4 border-b border-gray-200/70 pb-3 pt-3">
      <Skeleton className="h-6 w-44" />
      <Skeleton className="mt-2 h-3.5 w-32" />
      {below ? <Skeleton className="mt-3 h-11 w-full rounded-2xl" /> : null}
    </div>
  );
}

/** Placeholder for a list of rows — matches the real `.card-flush` list. */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="card-flush row-divide">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="mt-2 h-3 w-1/4" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/**
 * Empty states carry an icon and an action, because an empty screen with only
 * a sentence on it reads as a failure. The icon says "this is a place that
 * holds things"; the action says "here is how you put one here".
 */
export function EmptyState({
  title,
  description,
  action,
  icon = "package",
  compact = false,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: IconName;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-2xl border border-dashed
        border-gray-300 bg-white px-6 text-center ${compact ? "py-8" : "py-12"}`}
    >
      <span className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
        <Icon name={icon} size={22} />
      </span>
      <p className="text-[0.9375rem] font-bold text-gray-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-gray-500">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

/** Inline "something went wrong" panel, for failed fetches inside a screen. */
export function ErrorNote({
  message,
  action,
}: {
  message: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3.5 text-sm text-red-800 ring-1 ring-inset ring-red-600/10">
      <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1 leading-relaxed">{message}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
