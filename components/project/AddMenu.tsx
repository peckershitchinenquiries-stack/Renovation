"use client";

import { useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { IconTile } from "@/components/ui/List";

/*
 * The one way to add anything to a project (UX phase 4).
 *
 * Before this there were four different "add" patterns, in four different
 * places: a drawer button inside the Costs tab, a "+ Log invoice" button inside
 * the Invoices tab, a nav item, and — worst of the four — a "Log labour" link
 * that appeared ONLY in the Labour view's empty state, so it vanished the
 * moment the project had any labour on it. Logging the second day's work was
 * unreachable without deleting the first.
 *
 * So: one control, in the project header, listing everything you can add.
 * Nothing here decides what happens — ProjectDetail owns that, because the
 * three destinations genuinely differ (see `AddItem` below and the handlers in
 * ProjectDetail.tsx). This component owns only the affordance.
 *
 * Two renders, one list. Desktop gets a dropdown in the header's action row;
 * mobile gets a floating button and a bottom sheet, because the header scrolls
 * away and an add control you have to scroll up to find is the reachability
 * problem again in a different costume. Both map over ITEMS, so they cannot
 * drift apart — the same discipline ExpensesTab uses for its row menu/sheet.
 */

export type AddItem = "cost" | "invoice" | "labour";

const ITEMS: {
  key: AddItem;
  label: string;
  icon: IconName;
  tone: "brand" | "info" | "warn";
  hint: string;
}[] = [
  {
    key: "cost",
    label: "Cost",
    icon: "wallet",
    tone: "brand",
    hint: "Something paid for without an invoice",
  },
  {
    key: "invoice",
    label: "Invoice",
    icon: "receipt",
    tone: "info",
    // The multi-step flow is left exactly as it was — only the door into it
    // moved. See about.md §8.2.
    hint: "Photo, PDF or typed in",
  },
  {
    key: "labour",
    label: "Labour",
    icon: "hammer",
    tone: "warn",
    hint: "Work paid direct, by rate and hours",
  },
];

export default function AddMenu({ onSelect }: { onSelect: (item: AddItem) => void }) {
  // Two states, not one. The desktop dropdown and the mobile sheet are both
  // always mounted (only CSS hides the other), and the sheet locks body scroll
  // while it is open — so sharing one flag would freeze the desktop page behind
  // a sheet nobody can see.
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  function choose(item: AddItem) {
    setMenuOpen(false);
    setSheetOpen(false);
    onSelect(item);
  }

  const rows = ITEMS.map((item) => (
    <button
      key={item.key}
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition active:bg-gray-100 hover:bg-gray-50"
      onClick={() => choose(item.key)}
    >
      <IconTile name={item.icon} tone={item.tone} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-semibold text-gray-900">
          {item.label}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-gray-500">
          {item.hint}
        </span>
      </span>
      <Icon name="chevronRight" size={18} className="shrink-0 text-gray-300" />
    </button>
  ));

  return (
    <>
      {/* ---------------- Desktop: header dropdown ---------------- */}
      <div className="relative hidden sm:block">
        <button
          type="button"
          className="btn-primary btn-sm"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="plus" size={16} strokeWidth={2.25} />
          Add
          <Icon name="chevronDown" size={14} className="opacity-70" />
        </button>
        {menuOpen ? (
          <>
            {/* Click-away layer under the menu, above everything else. */}
            <div
              className="fixed inset-0 z-20"
              aria-hidden
              onClick={() => setMenuOpen(false)}
            />
            <div
              role="menu"
              className="absolute right-0 z-30 mt-2 w-72 animate-pop-in overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-1.5 shadow-pop"
            >
              {rows}
            </div>
          </>
        ) : null}
      </div>

      {/* ---------------- Mobile: FAB + bottom sheet ----------------
          The button sits above the bottom tab bar (and the iOS home indicator)
          rather than in the corner it used to occupy, which the new navigation
          now covers. */}
      <button
        type="button"
        aria-label="Add to this project"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
        style={{
          bottom: "calc(var(--nav-h) + env(safe-area-inset-bottom) + 0.75rem)",
        }}
        className="fixed right-4 z-30 flex h-14 items-center gap-2 rounded-2xl bg-brand px-4
          text-sm font-bold text-white shadow-fab transition active:scale-95
          active:bg-brand-800 sm:hidden"
      >
        <Icon name="plus" size={20} strokeWidth={2.25} />
        Add
      </button>

      <div className="sm:hidden">
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Add to this project"
          description="Three ways money gets recorded here."
          size="sm"
        >
          <div role="menu" className="-mx-2">
            {rows}
          </div>
        </Sheet>
      </div>
    </>
  );
}
