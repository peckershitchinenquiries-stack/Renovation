import React from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";

/**
 * The floating primary action.
 *
 * On a phone the top-right corner of a screen is the hardest place to reach
 * one-handed, and that is exactly where "Add" used to live. This sits just
 * above the tab bar on the right, inside the thumb arc, and stays put while
 * the list behind it scrolls.
 *
 * Mobile only: on desktop the action belongs in the page header, where there
 * is room to label it, so this hides at `sm:`.
 */
export function Fab({
  href,
  onClick,
  label,
  icon = "plus",
}: {
  href?: string;
  onClick?: () => void;
  /** Announced to screen readers, and shown as text on wider phones. */
  label: string;
  icon?: IconName;
}) {
  const className = `fixed right-4 z-30 flex h-14 items-center gap-2 rounded-2xl
    bg-brand px-4 text-sm font-bold text-white shadow-fab transition
    active:scale-95 active:bg-brand-800 sm:hidden`;
  const style = {
    bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom) + 0.75rem)",
  } as React.CSSProperties;

  const inner = (
    <>
      <Icon name={icon} size={20} strokeWidth={2.25} />
      <span>{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} aria-label={label} className={className} style={style}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={className}
      style={style}
    >
      {inner}
    </button>
  );
}
