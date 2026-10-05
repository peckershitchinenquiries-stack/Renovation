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
 * mobile gets a bottom sheet off the same button. Both map over ITEMS, so they
 * cannot drift apart — the same discipline ExpensesTab uses for its row
 * menu/sheet.
 *
 * The mobile trigger used to be a `fixed` FAB pinned above the tab bar, and it
 * did not work: PageHeader is `backdrop-blur-xl`, and an ancestor with a
 * backdrop-filter becomes the containing block for `position: fixed`
 * descendants. So `bottom: calc(var(--nav-h) …)` was measured from the header,
 * not the viewport, and the button landed on top of the project title at
 * full 56px FAB size. It is now an ordinary small button in the header's
 * action row, sized to match the desktop one and the `⋯` beside it.
 */

export type AddItem =
  | "cost"
  | "invoice"
  | "labour"
  | "document"
  | "snag"
  | "log";

/*
 * Two groups, not one list.
 *
 * It used to be three items — cost, invoice, labour — under a sheet that said
 * "Three ways money gets recorded here", while the button said "Add to this
 * project". The button was telling the truth about its job and the list was
 * not: you could not add a photo, a snag or a log entry from the one control
 * named after adding things, and each of those was two taps away behind an
 * Overview tile. Those three are exactly the ones done standing on site with
 * one hand, which is the worst possible place to need two taps and a tile.
 *
 * Orders and Variations are deliberately NOT here. Both are desk jobs — an
 * order is lines and quantities copied off a supplier's confirmation, a
 * variation is a written agreement — and both have a screen of their own built
 * for that. Adding them would make this list nine items long, which is a menu
 * you read rather than a menu you use.
 */
type AddGroup = "money" | "site";

const GROUP_LABELS: Record<AddGroup, string> = {
  money: "Money",
  site: "On site",
};

const ITEMS: {
  key: AddItem;
  group: AddGroup;
  label: string;
  icon: IconName;
  tone: "brand" | "info" | "warn" | "bad" | "neutral";
  hint: string;
}[] = [
  {
    key: "cost",
    group: "money",
    label: "Cost",
    icon: "wallet",
    tone: "brand",
    hint: "Something paid for without an invoice",
  },
  {
    key: "invoice",
    group: "money",
    label: "Invoice",
    icon: "receipt",
    tone: "info",
    // The multi-step flow is left exactly as it was — only the door into it
    // moved. See about.md §8.2.
    hint: "Photo, PDF or typed in",
  },
  {
    key: "labour",
    group: "money",
    label: "Labour",
    icon: "hammer",
    tone: "warn",
    hint: "Work paid direct, by rate and hours",
  },
  {
    key: "document",
    group: "site",
    label: "Photo or document",
    // `camera` rather than `receipt` for the same reason OverviewTab's tile
    // uses it: `receipt` means *invoice* everywhere else in this app, and this
    // store is mostly site photographs.
    icon: "camera",
    tone: "info",
    hint: "A photo, a certificate, a drawing",
  },
  {
    key: "snag",
    group: "site",
    label: "Snag",
    icon: "alert",
    tone: "bad",
    hint: "Something that needs putting right",
  },
  {
    key: "log",
    group: "site",
    label: "Log entry",
    icon: "list",
    tone: "neutral",
    hint: "A call, a visit, a decision",
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

  // One rendering, used by both the desktop dropdown and the mobile sheet, so
  // the two cannot drift apart. Six items is enough that they need the two
  // headings to be scannable — "Money" and "On site" is the division people
  // already have in their heads.
  const rows = (["money", "site"] as AddGroup[]).map((group) => (
    <div key={group} className="first:mt-0 mt-1.5 first:pt-0 pt-1.5 first:border-0 border-t border-gray-200/70">
      <p className="px-3 pb-1 pt-1.5 text-2xs font-bold uppercase tracking-wider text-gray-400">
        {GROUP_LABELS[group]}
      </p>
      {ITEMS.filter((item) => item.group === group).map((item) => (
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
      ))}
    </div>
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

      {/* ---------------- Mobile: header button + bottom sheet ----------------
          Same `btn-primary btn-sm` as the desktop trigger, so it lines up with
          the title and the `⋯` button on the same row. */}
      <button
        type="button"
        aria-label="Add to this project"
        aria-expanded={sheetOpen}
        onClick={() => setSheetOpen(true)}
        className="btn-primary btn-sm sm:hidden"
      >
        <Icon name="plus" size={16} strokeWidth={2.25} />
        Add
      </button>

      <div className="sm:hidden">
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Add to this project"
          description="Money, and what you noted on site."
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
