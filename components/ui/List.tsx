import React from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";

/**
 * The list vocabulary the whole app shares.
 *
 * Nearly every screen here is "a list of things you can open". Before this,
 * each one drew its own card, its own divider and its own chevron, so no two
 * lists lined up. These four pieces are that pattern, once.
 */

/** A grouped list: one rounded surface, hairline rules between rows. */
export function ListCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-flush row-divide ${className}`}>{children}</div>
  );
}

/**
 * A tappable row. Renders as a `Link` when given `href`, a `button` when given
 * `onClick`, and a plain `div` when given neither — so a read-only row never
 * has to pretend to be interactive to look right.
 */
export function ListRow({
  href,
  onClick,
  icon,
  iconTone = "neutral",
  leading,
  title,
  subtitle,
  meta,
  trailing,
  chevron,
  className = "",
}: {
  href?: string;
  onClick?: () => void;
  /** Renders a tinted icon tile at the start of the row. */
  icon?: IconName;
  iconTone?: "neutral" | "brand" | "good" | "warn" | "bad" | "info";
  /** Custom leading element — takes precedence over `icon`. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned block, usually an amount over a status. */
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  /** Defaults to on for links, off otherwise. */
  chevron?: boolean;
  className?: string;
}) {
  const showChevron = chevron ?? Boolean(href);

  const inner = (
    <>
      {leading ?? (icon ? <IconTile name={icon} tone={iconTone} /> : null)}

      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.9375rem] font-semibold leading-snug text-gray-900">
          {title}
        </div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-[0.8125rem] leading-snug text-gray-500">
            {subtitle}
          </div>
        ) : null}
      </div>

      {meta ? (
        <div className="shrink-0 text-right leading-snug">{meta}</div>
      ) : null}
      {trailing}
      {showChevron ? (
        <Icon name="chevronRight" size={18} className="shrink-0 text-gray-300" />
      ) : null}
    </>
  );

  const classes = `row ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {inner}
      </button>
    );
  }
  return <div className={`${classes} active:bg-transparent`}>{inner}</div>;
}

const TILE_TONES = {
  neutral: "bg-gray-100 text-gray-500",
  brand: "bg-brand-50 text-brand-700",
  good: "bg-emerald-50 text-emerald-600",
  warn: "bg-amber-50 text-amber-600",
  bad: "bg-red-50 text-red-600",
  info: "bg-blue-50 text-blue-600",
} as const;

export function IconTile({
  name,
  tone = "neutral",
  size = "md",
}: {
  name: IconName;
  tone?: keyof typeof TILE_TONES;
  size?: "sm" | "md" | "lg";
}) {
  const box = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-11 w-11" : "h-9 w-9";
  const glyph = size === "sm" ? 16 : size === "lg" ? 20 : 18;
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center rounded-xl ${TILE_TONES[tone]}`}
    >
      <Icon name={name} size={glyph} />
    </span>
  );
}

/**
 * A label/value pair for detail screens — the read-only counterpart of a form
 * field. Value is right-aligned and tabular so a column of them lines up.
 */
export function DataRow({
  label,
  value,
  strong = false,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="shrink-0 text-[0.8125rem] text-gray-500">{label}</dt>
      <dd
        className={`tnum min-w-0 truncate text-right text-[0.9375rem] ${
          strong ? "font-bold text-gray-900" : "font-medium text-gray-800"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
