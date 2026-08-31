import React from "react";
import { Icon, type IconName } from "./Icon";

/**
 * A single number, given room to be read.
 *
 * The old version stacked a shouty uppercase label above the figure, which
 * made the label compete with the thing it labels. Here the number is the
 * largest element on the card and the label sits under it, quiet — so a row of
 * these scans as a row of *amounts*, which is what the reader came for.
 */
export function StatCard({
  label,
  value,
  tone = "neutral",
  hint,
  icon,
  className = "",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad" | "brand";
  hint?: string;
  icon?: IconName;
  className?: string;
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-700"
      : tone === "bad"
        ? "text-red-600"
        : tone === "brand"
          ? "text-brand-700"
          : "text-gray-900";

  return (
    <div className={`card ${className}`}>
      {icon ? (
        <span className="mb-2.5 flex h-8 w-8 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
          <Icon name={icon} size={17} />
        </span>
      ) : null}
      <p
        className={`tnum text-[1.375rem] font-bold leading-none tracking-[-0.02em] ${valueClass}`}
      >
        {value}
      </p>
      <p className="mt-1.5 text-[0.8125rem] font-medium leading-tight text-gray-500">
        {label}
      </p>
      {hint ? (
        <p className="mt-1 text-xs leading-tight text-gray-400">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The headline figure of a screen — one per page at most.
 * Used for a project's total spend, where a normal StatCard reads as an
 * afterthought next to the chart beside it.
 */
export function HeroStat({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl bg-gradient-to-br from-brand-800 via-brand to-brand-600 p-5 text-white shadow-soft">
      <p className="text-[0.8125rem] font-medium text-white/70">{label}</p>
      <p className="tnum mt-1.5 text-[2rem] font-bold leading-none tracking-[-0.03em]">
        {value}
      </p>
      {sub ? <div className="mt-2 text-sm text-white/80">{sub}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
