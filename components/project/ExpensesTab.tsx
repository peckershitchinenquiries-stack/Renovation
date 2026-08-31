"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import {
  formatCurrency,
  paidState,
  PAID_TOLERANCE,
  type PaidState,
} from "@/lib/calculations";
import { round2 } from "@/lib/purchases";
import { MONEY } from "@/lib/vocabulary";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { Sheet } from "@/components/ui/Sheet";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { IconTile } from "@/components/ui/List";
import ExpenseForm from "@/components/forms/ExpenseForm";
import { fmtDate } from "@/components/project/format";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  type Project,
  type ExpenseEntryComputed,
  type InvoiceLineView,
  type TradeLookup,
} from "@/types";

/*
 * The Costs tab — the week-by-week diary.
 *
 * Rebuilt 2026-08-28 (UX phase 2). Nothing about what a number *means* changed:
 * every figure still comes from `computeEntry` / `paidState`, and every write
 * still goes through the same PATCH and DELETE handlers. What changed is what
 * the screen shows and how you touch it. The three things worth knowing before
 * editing:
 *
 * 1. SIX COLUMNS, not twelve. Description · Category · Cost · Paid · Status ·
 *    row menu. Owed is Cost − Paid, so it is derivable and is shown only where
 *    it answers a question: the row expander and the totals. Committed lives
 *    behind the "Compare to committed" toggle, which swaps the Cost column for
 *    a Committed → Cost variance. Notes, paid date and payment method are in
 *    the expander.
 *
 * 2. ONE CONTROL, ONE DIALOG. There used to be a <select> per row whose
 *    onChange sometimes wrote silently, sometimes opened a payment dialog and
 *    sometimes opened a different dialog — a control that looks like a dropdown
 *    but occasionally opens a modal. It is now a status CHIP that always opens
 *    the same "Update status" dialog, which carries status, amount, date and
 *    method together. The guards it used to hide are all still here, in
 *    `submitStatus`: cumulative payment amounts, and the clear-payment question
 *    when a paid row goes back to Planned / In Progress.
 *
 * 3. THE CHIP SHOWS THE DERIVED STATE, not the stored one. `paidState` is the
 *    single answer to "how much has actually been handed over"; the stored
 *    `status` column is demoted to a small flag beside it. This is why the tab
 *    no longer needs the old rule about suppressing a stale paid date — the
 *    date only appears where the derived state says money moved.
 */

const EMPTY_FILTERS = {
  week_from: "",
  week_to: "",
  category: "",
  trade: "",
  status: "",
  payment_method: "",
};
type FilterKey = keyof typeof EMPTY_FILTERS;

// Rows whose id looks like `inv:<uuid>` are invoices shown in the diary, not
// expense rows. They live in `purchases` and are edited on the invoice form —
// see the row menu and the PATCH handler for why.
const isInvoice = (e: { id: string }) => e.id.startsWith("inv:");
const purchaseIdOf = (e: { id: string }) => e.id.slice(4);

const todayISO = () => new Date().toISOString().slice(0, 10);

// The two statuses that mean "not paid". Choosing one of these on a row that
// already has money against it is the moment to ask whether the money should go
// too, rather than leaving a Planned row displaying a paid date.
const UNPAID_STATUSES = new Set<string>(["Planned", "In Progress"]);

// What "this row has payment data" means, which differs by kind of row.
//
// An expense row owns its `paid_date` column outright, so a date with no money
// is still payment data — it is exactly the stale value this screen used to
// show. An invoice's `paid_date` is really the DOCUMENT's date (purchase_date),
// present on almost every invoice whether or not a penny has been paid, so for
// those only the money counts.
function hasPaymentData(e: ExpenseEntryComputed): boolean {
  if (Number(e.paid_amount) > 0) return true;
  return isInvoice(e) ? false : Boolean(e.paid_date);
}

const owedOn = (e: ExpenseEntryComputed) =>
  round2(e.total_incl_vat - Number(e.paid_amount));

/** The daily question this tab exists to answer. */
type Quick = "all" | "owed" | "paid";

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

/**
 * The status chip — the whole status control, on every row, on both renders.
 *
 * It shows the DERIVED payment state, with the amounts spelled out on a
 * part-paid row, because "Partial" on its own never told anyone how much was
 * left. Clicking it always opens the same dialog.
 */
function StatusChip({
  pay,
  entry,
  onClick,
}: {
  pay: PaidState;
  entry: ExpenseEntryComputed;
  onClick: () => void;
}) {
  const style =
    pay === "Paid"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15 active:bg-emerald-100"
      : pay === "Partial"
        ? "bg-amber-50 text-amber-800 ring-amber-600/20 active:bg-amber-100"
        : pay === "None"
          ? "bg-red-50 text-red-700 ring-red-600/15 active:bg-red-100"
          : "bg-gray-100 text-gray-600 ring-gray-500/15 active:bg-gray-200";

  const dot =
    pay === "Paid"
      ? "bg-emerald-500"
      : pay === "Partial"
        ? "bg-amber-500"
        : pay === "None"
          ? "bg-red-500"
          : "bg-gray-400";

  const label =
    pay === "Paid"
      ? "Paid"
      : pay === "None"
        ? "Cancelled"
        : pay === "Partial"
          ? `Part-paid ${formatCurrency(Number(entry.paid_amount))} of ${formatCurrency(
              entry.total_incl_vat
            )}`
          : "Unpaid";

  return (
    <button
      type="button"
      onClick={onClick}
      title="Update status"
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1
        text-2xs font-semibold leading-none ring-1 ring-inset transition
        active:scale-95 ${style}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * The stored status, when it is not already obvious from the chip.
 *
 * Two status systems are in play on every row — the stored column and the
 * derived state — and pretending otherwise is what made the old Date Paid cell
 * need a special case. Planned / In Progress are shown as a quiet flag;
 * "Marked Paid" appears when the column claims Paid but no money reached it,
 * which is a disagreement worth seeing rather than hiding.
 */
function statusFlag(e: ExpenseEntryComputed, pay: PaidState): string | null {
  if (pay === "None") return null;
  if (e.status === "Paid" && pay !== "Paid") return "Marked Paid";
  return UNPAID_STATUSES.has(e.status) ? e.status : null;
}

/**
 * The leading affordance — an invoice behaves differently from an expense, so
 * it has to look different BEFORE anything is clicked: Edit leaves this screen
 * for the invoice form, there is no Repeat, and Delete takes the invoice's
 * lines and payments with it.
 */
function RowKind({ invoice }: { invoice: boolean }) {
  return (
    <span
      title={invoice ? "Invoice" : "Expense"}
      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
        invoice ? "bg-violet-50 text-violet-600" : "bg-gray-100 text-gray-400"
      }`}
    >
      <Icon name={invoice ? "receipt" : "wallet"} size={16} />
    </span>
  );
}

/** One figure in the mobile totals card. */
function TotalCell({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="rounded-xl bg-gray-100 px-3 py-2.5">
      <dt className="text-2xs font-medium text-gray-500">{label}</dt>
      <dd
        className={`tnum mt-0.5 text-[0.9375rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-600"
              : "text-gray-900"
        }`}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

/** Committed → Cost, shown only behind the toggle. */
function VarianceCell({ e }: { e: ExpenseEntryComputed }) {
  const committed = Number(e.quoted_amount);
  const delta = round2(e.total_incl_vat - committed);
  return (
    <div className="text-right">
      <div className="tnum text-xs text-gray-400">
        {committed > 0 ? formatCurrency(committed) : "not quoted"}
      </div>
      <div className="tnum font-semibold text-gray-900">
        {formatCurrency(e.total_incl_vat)}
      </div>
      {committed > 0 ? (
        <span
          className={`tnum mt-1 inline-flex rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset ${
            Math.abs(delta) < 0.005
              ? "bg-gray-100 text-gray-600 ring-gray-500/15"
              : delta > 0
                ? "bg-red-50 text-red-700 ring-red-600/15"
                : "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
          }`}
        >
          {Math.abs(delta) < 0.005
            ? "on quote"
            : `${delta > 0 ? "+" : "−"}${formatCurrency(Math.abs(delta))}`}
        </span>
      ) : null}
    </div>
  );
}

export default function ExpensesTab({
  project,
  entries,
  trades,
  invoiceLines,
  addRequested = false,
  onAddConsumed,
  onChanged,
}: {
  project: Project;
  entries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  invoiceLines: InvoiceLineView[];
  // Set by the project header's "+ Add → Cost". The drawer stays here rather
  // than in the header because everything it needs — trades, the next week
  // number, the prior entries it prefills from — is here; the header just asks
  // for it.
  //
  // It is a request that gets CONSUMED, not a counter, because this tab is
  // unmounted whenever another tab is showing. A flag left standing would
  // reopen the drawer every time you came back to Costs; clearing it the
  // moment it is acted on is what stops that.
  addRequested?: boolean;
  onAddConsumed?: () => void;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();

  // --- what is on screen -------------------------------------------------
  const [query, setQuery] = useState("");
  const [quick, setQuick] = useState<Quick>("all");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  // Which of the six extra filters are currently offered as pills. A filter
  // with a value is always shown; this set is what keeps an empty one visible
  // after "+ Add filter" and before anything is chosen.
  const [shown, setShown] = useState<FilterKey[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [compare, setCompare] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // --- dialogs and menus -------------------------------------------------
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseEntryComputed | null>(null);
  // Set when repeating a past entry: prefills a new entry instead of editing.
  const [template, setTemplate] = useState<ExpenseEntryComputed | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntryComputed | null>(
    null
  );
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [sheetFor, setSheetFor] = useState<ExpenseEntryComputed | null>(null);

  // The one status/payment dialog. Nothing is written until it is submitted.
  const [statusTarget, setStatusTarget] = useState<ExpenseEntryComputed | null>(
    null
  );
  const [statusForm, setStatusForm] = useState({
    status: "Planned",
    paid_date: todayISO(),
    amount: "",
    payment_method: "",
  });
  const [statusError, setStatusError] = useState("");

  // Moving a paid row back to Planned / In Progress: the status and the money
  // have to be decided together, or the row keeps displaying a payment it no
  // longer claims to have had.
  const [clearTarget, setClearTarget] = useState<{
    entry: ExpenseEntryComputed;
    status: string;
  } | null>(null);

  // The Costs tab is the week-by-week diary: it shows only 'diary' rows
  // (File 1 + anything added in-app). Imported 'ledger' rows (File 2) live in
  // the Analysis tab's pivots instead.
  const diaryEntries = useMemo(
    () => entries.filter((e) => e.source !== "ledger"),
    [entries]
  );

  const nextWeek = useMemo(() => {
    const max = diaryEntries.reduce((m, e) => Math.max(m, e.week_number), 0);
    return max + 1;
  }, [diaryEntries]);

  const filterDefs = useMemo(
    () =>
      [
        { key: "week_from" as FilterKey, label: "Week from", options: null },
        { key: "week_to" as FilterKey, label: "Week to", options: null },
        {
          key: "category" as FilterKey,
          label: "Category",
          options: [...EXPENSE_CATEGORIES] as string[],
        },
        {
          key: "trade" as FilterKey,
          label: "Trade",
          options: trades.map((t) => t.name),
        },
        {
          key: "status" as FilterKey,
          label: "Status",
          options: [...EXPENSE_STATUSES] as string[],
        },
        {
          key: "payment_method" as FilterKey,
          label: "Payment",
          options: [...PAYMENT_METHODS] as string[],
        },
      ] as const,
    [trades]
  );

  // A pill is on screen if it holds a value or was just added.
  const visibleFilters = useMemo(
    () => filterDefs.filter((d) => filters[d.key] || shown.includes(d.key)),
    [filterDefs, filters, shown]
  );
  const addable = useMemo(
    () => filterDefs.filter((d) => !visibleFilters.includes(d)),
    [filterDefs, visibleFilters]
  );
  const anyFilter =
    Boolean(query) ||
    quick !== "all" ||
    Object.values(filters).some(Boolean) ||
    shown.length > 0;

  function clearAll() {
    setQuery("");
    setQuick("all");
    setFilters(EMPTY_FILTERS);
    setShown([]);
  }

  function dropFilter(key: FilterKey) {
    setFilters((f) => ({ ...f, [key]: "" }));
    setShown((s) => s.filter((k) => k !== key));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return diaryEntries.filter((e) => {
      if (q) {
        const hay = `${e.description} ${e.supplier ?? ""} ${e.trade ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (quick !== "all") {
        const pay = paidState(e);
        if (quick === "owed" && pay !== "Unpaid" && pay !== "Partial")
          return false;
        if (quick === "paid" && pay !== "Paid") return false;
      }
      if (filters.week_from && e.week_number < Number(filters.week_from))
        return false;
      if (filters.week_to && e.week_number > Number(filters.week_to)) return false;
      if (filters.category && e.category !== filters.category) return false;
      if (filters.trade && e.trade !== filters.trade) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.payment_method && e.payment_method !== filters.payment_method)
        return false;
      return true;
    });
  }, [diaryEntries, query, quick, filters]);

  // Every row paired with its derived payment state, computed once. The Pay
  // button, the chip and the expander all read this one value.
  const rows = useMemo(
    () => filtered.map((e) => ({ e, pay: paidState(e) as PaidState })),
    [filtered]
  );

  // week_number is the organising fact of this data — it is a week-by-week
  // plan, not a flat list — so the rows are grouped by it and each group
  // carries its own Cost and Owed. Newest week first: that is the one being
  // worked on.
  const groups = useMemo(() => {
    const byWeek = new Map<number, typeof rows>();
    for (const r of rows) {
      const list = byWeek.get(r.e.week_number);
      if (list) list.push(r);
      else byWeek.set(r.e.week_number, [r]);
    }
    return [...byWeek.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([week, items]) => {
        // Same basis as the grand totals: Cancelled rows are listed but never
        // counted.
        const sums = items.reduce(
          (acc, { e }) => {
            if (e.status === "Cancelled") return acc;
            acc.cost += e.total_incl_vat;
            acc.owed += e.remaining;
            return acc;
          },
          { cost: 0, owed: 0 }
        );
        return { week, items, ...sums };
      });
  }, [rows]);

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, e) => {
        if (e.status === "Cancelled") return acc;
        acc.quoted += Number(e.quoted_amount);
        acc.actual += e.total_incl_vat;
        acc.paid += Number(e.paid_amount);
        acc.remaining += e.remaining;
        return acc;
      },
      { quoted: 0, actual: 0, paid: 0, remaining: 0 }
    );
  }, [filtered]);

  function toggleExpanded(id: string) {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAdd() {
    setEditing(null);
    setTemplate(null);
    setDrawerOpen(true);
  }
  function openEdit(e: ExpenseEntryComputed) {
    setEditing(e);
    setTemplate(null);
    setDrawerOpen(true);
  }
  // The header's "+ Add → Cost" arriving. Works on mount (the header switched
  // to this tab to get here) as well as while it is already open.
  useEffect(() => {
    if (!addRequested) return;
    openAdd();
    onAddConsumed?.();
    // openAdd only sets state, and is stable enough for this: re-running on a
    // render where addRequested is still true is exactly what consuming it
    // prevents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addRequested]);

  // Log the same thing again — prefilled, so usually only the price changes.
  function openRepeat(e: ExpenseEntryComputed) {
    setEditing(null);
    setTemplate(e);
    setDrawerOpen(true);
  }

  /**
   * Open the one status dialog.
   *
   * `presetPaid` is what the row's Pay button uses: same dialog, opened with
   * Paid already chosen and the outstanding amount filled in. The date defaults
   * to today for every row — this is the date the money moved, which for an
   * invoice is emphatically not the document's own date; paying a three-month
   * -old invoice today must not record the payment three months ago.
   */
  function openStatus(e: ExpenseEntryComputed, presetPaid = false) {
    const outstanding = owedOn(e);
    setStatusForm({
      status: presetPaid ? "Paid" : e.status,
      paid_date: todayISO(),
      amount: presetPaid && outstanding > 0 ? outstanding.toFixed(2) : "",
      payment_method: e.payment_method ?? "",
    });
    setStatusError("");
    setStatusTarget(e);
    setMenuFor(null);
    setSheetFor(null);
  }

  /**
   * The single write path for a status change, with or without money.
   *
   * Every guard the old status dropdown hid behind an onChange is here, in one
   * place and in sight of the fields it applies to.
   */
  async function submitStatus() {
    const e = statusTarget;
    if (!e) return;

    const next = statusForm.status;
    const outstanding = owedOn(e);
    const owes = outstanding > PAID_TOLERANCE;
    const typedAmount = statusForm.amount.trim() !== "";
    // Money is only in play on a row that still owes something and is moving
    // to a status that means work/money is happening.
    const paying = owes && typedAmount && (next === "Paid" || next === "In Progress");

    if (next === "Paid" && owes && !typedAmount) {
      setStatusError(
        "Enter how much was paid, or choose a different status. Nothing is marked Paid without money against it."
      );
      return;
    }

    if (paying) {
      const amount = round2(Number(statusForm.amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        setStatusError("Enter an amount greater than zero.");
        return;
      }
      if (!statusForm.paid_date) {
        setStatusError("Choose the date the payment was made.");
        return;
      }

      // Always sent as the CUMULATIVE figure. An expense row stores that number
      // directly; for an invoice the handler turns it into a payment for the
      // difference only, so submitting twice cannot pay twice (see patchInvoice).
      const newPaid = round2(Number(e.paid_amount) + amount);
      const settled = newPaid >= e.total_incl_vat - PAID_TOLERANCE;

      const body: Record<string, unknown> = {
        status: settled ? "Paid" : "In Progress",
        paid_amount: newPaid,
        paid_date: statusForm.paid_date,
      };
      // Only sent when chosen, so leaving it blank does not wipe a method that
      // is already recorded on the row.
      if (statusForm.payment_method)
        body.payment_method = statusForm.payment_method;

      try {
        await apiFetch(`/api/projects/${project.id}/expenses/${e.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast(settled ? "Marked as paid" : "Payment recorded", "success");
        setStatusTarget(null);
        await onChanged();
      } catch (err) {
        // Left open rather than dismissed, so the amount can be corrected — the
        // commonest failure here is over-paying an invoice, which the handler
        // rejects with an explanation.
        setStatusError(err instanceof Error ? err.message : "Update failed");
      }
      return;
    }

    if (next === e.status) {
      setStatusTarget(null);
      return;
    }
    // Back to Planned / In Progress with money already recorded: ask about the
    // money in the same breath as the status.
    if (UNPAID_STATUSES.has(next) && hasPaymentData(e)) {
      setStatusTarget(null);
      setClearTarget({ entry: e, status: next });
      return;
    }
    setStatusTarget(null);
    void updateStatus(e, next);
  }

  async function updateStatus(
    e: ExpenseEntryComputed,
    newStatus: string,
    clearPayment = false
  ) {
    const body: Record<string, unknown> = { status: newStatus };
    if (clearPayment) {
      body.paid_date = null;
      body.paid_amount = 0;
    }
    try {
      await apiFetch(`/api/projects/${project.id}/expenses/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast("Status updated", "success");
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Update failed", "error");
    }
  }

  async function doDelete(e: ExpenseEntryComputed) {
    try {
      await apiFetch(`/api/projects/${project.id}/expenses/${e.id}`, {
        method: "DELETE",
      });
      toast("Expense deleted", "success");
      await onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  async function openReceipt(e: ExpenseEntryComputed) {
    const newTab = window.open("about:blank", "_blank", "noopener");
    if (!newTab) {
      toast("Popup blocked. Please allow popups.", "error");
      return;
    }
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/expenses/${e.id}/receipt`
      );
      newTab.location.href = url;
    } catch {
      newTab.close();
      toast("Could not open receipt", "error");
    }
  }

  /**
   * Everything the row can do apart from Pay, in one list so the desktop menu
   * and the mobile sheet cannot drift apart. Delete is marked `danger` and is
   * rendered last, below a divider — it used to be a bare text link the same
   * size and weight as Edit.
   */
  type Action = {
    key: string;
    label: string;
    href?: string;
    onClick?: () => void;
    danger?: boolean;
  };
  function actionsFor(e: ExpenseEntryComputed): Action[] {
    const list: Action[] = [];
    if (isInvoice(e)) {
      // An invoice's supplier, lines and amounts are properties of the
      // document, and only the invoice form can change them without leaving the
      // header disagreeing with the lines it is made of.
      list.push({
        key: "edit",
        label: "Edit invoice",
        href: `/projects/${project.id}/purchases/${purchaseIdOf(e)}/edit?returnTo=${encodeURIComponent(
          `/projects/${project.id}?tab=expenses`
        )}`,
      });
    } else {
      list.push({ key: "repeat", label: "Repeat", onClick: () => openRepeat(e) });
      list.push({ key: "edit", label: "Edit", onClick: () => openEdit(e) });
    }
    if (e.receipt_url)
      list.push({
        key: "receipt",
        label: "View receipt",
        onClick: () => void openReceipt(e),
      });
    list.push({
      key: "delete",
      label: isInvoice(e) ? "Delete invoice" : "Delete",
      danger: true,
      onClick: () => setDeleteTarget(e),
    });
    return list;
  }

  function closeMenus() {
    setMenuFor(null);
    setSheetFor(null);
  }

  // The second line under a description: where it came from and when.
  const metaLine = (e: ExpenseEntryComputed) =>
    [e.supplier, e.trade, `week ${e.week_number}`].filter(Boolean).join(" · ");

  const payLabel = (pay: PaidState) => (pay === "Partial" ? "Pay balance" : "Pay");

  // The expander's contents, shared by both renders: everything cut from the
  // twelve columns that is still worth having when you ask for it.
  const details = (e: ExpenseEntryComputed, pay: PaidState) => (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <div>
        <dt className="text-2xs font-medium text-gray-500" title={MONEY.committed.hint}>
          {MONEY.committed.label}
        </dt>
        <dd className="tnum mt-0.5 text-[0.8125rem] font-semibold text-gray-900">
          {Number(e.quoted_amount) > 0
            ? formatCurrency(Number(e.quoted_amount))
            : "not quoted"}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-medium text-gray-500" title={MONEY.owed.hint}>
          {MONEY.owed.label}
        </dt>
        <dd
          className={`tnum mt-0.5 text-[0.8125rem] font-semibold ${
            e.remaining > 0.001 ? "text-red-600" : "text-gray-900"
          }`}
        >
          {formatCurrency(e.remaining)}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-medium text-gray-500">Date paid</dt>
        {/* A row with nothing paid against it has no paid date, whatever the
            column happens to hold. */}
        <dd className="mt-0.5 text-[0.8125rem] font-semibold text-gray-900">
          {pay === "Unpaid" || pay === "None" ? "—" : fmtDate(e.paid_date)}
        </dd>
      </div>
      <div>
        <dt className="text-2xs font-medium text-gray-500">Payment method</dt>
        <dd className="mt-0.5 text-[0.8125rem] font-semibold text-gray-900">
          {pay !== "Unpaid" && pay !== "None" && e.payment_method
            ? e.payment_method
            : "—"}
        </dd>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <dt className="text-2xs font-medium text-gray-500">Notes</dt>
        <dd className="mt-0.5 whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-gray-800">
          {e.notes || "—"}
        </dd>
      </div>
      {e.status === "Cancelled" ? (
        <p className="col-span-2 text-xs text-gray-400 sm:col-span-4">
          Cancelled — listed here but not counted in any total.
        </p>
      ) : null}
    </dl>
  );

  return (
    <div className="space-y-3">
      {/* What this tab is. The "+ Add Expense" button that used to sit on this
          row is gone: adding anything to a project is one control in the
          project header now (AddMenu.tsx), rather than a different button on
          each tab. The empty state below keeps its own — an empty screen is
          the one place the action belongs in the body. */}
      <p className="text-[0.8125rem] leading-relaxed text-gray-500">
        Everything this job has cost, week by week — expenses you enter here and
        the invoices filed against it.
      </p>

      {diaryEntries.length === 0 ? (
        /* Was `entries.length === 0`, which is not what the list renders: a
           project holding only ledger rows showed a table with no rows in it
           and no empty state at all. */
        <EmptyState
          icon="wallet"
          title="No costs yet"
          description="Add an expense for anything paid for without an invoice. Invoices you log appear here too, marked as invoices."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={openAdd}>
                <Icon name="plus" size={18} strokeWidth={2.25} />
                Add expense
              </button>
              <Link href="/invoices" className="btn-secondary">
                Log an invoice
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {/* Search, the daily question, then filters only if asked for.
              The row of native `<select>` elements that used to live inside
              these pills is gone: six OS-drawn dropdowns on one line is the
              single least app-like thing a phone screen can show. Each pill now
              opens the app's own sheet (components/ui/Select.tsx). */}
          <div className="space-y-2.5">
            <div className="relative">
              <label className="sr-only" htmlFor="costs-search">
                Search
              </label>
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                id="costs-search"
                className="input pl-10 pr-10"
                placeholder="Search description, supplier or trade"
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="btn-icon absolute right-1 top-1/2 h-9 min-h-0 w-9 min-w-0 -translate-y-1/2 text-gray-400"
                >
                  <Icon name="close" size={16} />
                </button>
              ) : null}
            </div>

            {/* The question actually asked every day: what still needs
                paying? Full width on a phone, so all three are equally easy
                to hit. */}
            <SegmentedControl<Quick>
              fill
              label="Payment filter"
              value={quick}
              onChange={setQuick}
              options={[
                { value: "all", label: "All" },
                { value: "owed", label: MONEY.owed.label },
                { value: "paid", label: MONEY.paid.label },
              ]}
            />

            {visibleFilters.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {visibleFilters.map((d) => (
                  <div key={d.key} className="flex items-end gap-1">
                    <div className="min-w-0 flex-1">
                      <label className="label mb-1 text-2xs uppercase tracking-wider text-gray-500">
                        {d.label}
                      </label>
                      {d.options ? (
                        <Select
                          aria-label={d.label}
                          title={d.label}
                          placeholder="Any"
                          clearable
                          className="!min-h-[2.5rem] !py-1.5 !text-sm"
                          value={filters[d.key]}
                          onChange={(v) =>
                            setFilters((f) => ({ ...f, [d.key]: v }))
                          }
                          options={d.options.map((o) => ({ value: o, label: o }))}
                        />
                      ) : (
                        <input
                          aria-label={d.label}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          placeholder="Any"
                          className="input !min-h-[2.5rem] !py-1.5 !text-sm"
                          value={filters[d.key]}
                          onChange={(ev) =>
                            setFilters((f) => ({ ...f, [d.key]: ev.target.value }))
                          }
                        />
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${d.label} filter`}
                      className="btn-icon mb-0.5 h-10 min-h-0 w-8 min-w-0 shrink-0 text-gray-400"
                      onClick={() => dropFilter(d.key)}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {addable.length > 0 ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-expanded={addOpen}
                  onClick={() => setAddOpen(true)}
                >
                  <Icon name="filter" size={14} />
                  Add filter
                </button>
              ) : null}

              {/* Committed is a comparison, not a filter, so it reads as a
                  toggle rather than another checkbox in the filter row. */}
              <button
                type="button"
                role="switch"
                aria-checked={compare}
                onClick={() => setCompare((c) => !c)}
                className={`btn btn-sm ${
                  compare
                    ? "bg-brand-50 text-brand-800"
                    : "border border-gray-200 bg-white text-gray-600"
                }`}
              >
                <span
                  className={`flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition ${
                    compare ? "bg-brand" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`h-3 w-3 rounded-full bg-white transition-transform ${
                      compare ? "translate-x-3" : ""
                    }`}
                  />
                </span>
                vs {MONEY.committed.label.toLowerCase()}
              </button>

              <span className="ml-auto text-xs text-gray-500">
                {filtered.length === diaryEntries.length
                  ? `${diaryEntries.length} ${
                      diaryEntries.length === 1 ? "entry" : "entries"
                    }`
                  : `${filtered.length} of ${diaryEntries.length}`}
              </span>
              {anyFilter ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-brand-700"
                  onClick={clearAll}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          {/* Which filter to add — a sheet, so the list is thumb-sized rather
              than a 14px dropdown anchored to a small button. */}
          <Sheet
            open={addOpen}
            onClose={() => setAddOpen(false)}
            title="Add a filter"
            size="sm"
          >
            <div className="-mx-2">
              {addable.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className="flex min-h-touch w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.9375rem] font-medium text-gray-900 transition active:bg-gray-100"
                  onClick={() => {
                    setShown((s) => [...s, d.key]);
                    setAddOpen(false);
                  }}
                >
                  <Icon name="filter" size={17} className="text-gray-400" />
                  {d.label}
                </button>
              ))}
            </div>
          </Sheet>

          {filtered.length === 0 ? (
            /* An empty table under a totals row of £0.00 reads as a project
               that has spent nothing. Say what actually happened instead. */
            <EmptyState
              icon="search"
              compact
              title="Nothing matches"
              description="No cost on this project matches that search and those filters."
              action={
                <button type="button" className="btn-secondary" onClick={clearAll}>
                  Clear all
                </button>
              }
            />
          ) : (
            <>
              {/* ---------------- Mobile ---------------- */}
              <div className="space-y-4 sm:hidden">
                {groups.map((g) => (
                  <div key={g.week}>
                    {/* The week header sticks under the page header rather than
                        at viewport top, so it is never hidden behind it. */}
                    <div className="sticky top-[8.5rem] z-10 mb-2 flex items-baseline justify-between gap-3 rounded-xl bg-gray-100/95 px-3 py-2 backdrop-blur">
                      <span className="text-[0.8125rem] font-bold text-gray-800">
                        Week {g.week}
                      </span>
                      <span className="tnum text-xs text-gray-500">
                        {formatCurrency(g.cost)}
                        {g.owed > 0.001 ? (
                          <span className="font-semibold text-red-600">
                            {" · "}
                            {formatCurrency(g.owed)} {MONEY.owed.label.toLowerCase()}
                          </span>
                        ) : null}
                      </span>
                    </div>

                    <div className="card-flush row-divide">
                      {g.items.map(({ e, pay }) => {
                        const open = expanded.has(e.id);
                        return (
                          <div key={e.id} className="px-4 py-3.5">
                            <div className="flex items-start gap-3">
                              <RowKind invoice={isInvoice(e)} />
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                aria-expanded={open}
                                onClick={() => toggleExpanded(e.id)}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span className="min-w-0 truncate text-[0.9375rem] font-semibold leading-snug text-gray-900">
                                    {e.description}
                                  </span>
                                  <Icon
                                    name={open ? "chevronUp" : "chevronDown"}
                                    size={14}
                                    className="shrink-0 text-gray-300"
                                  />
                                </span>
                                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
                                  {metaLine(e)}
                                  {e.category ? ` · ${e.category}` : ""}
                                  {e.receipt_url ? (
                                    <Icon
                                      name="link"
                                      size={11}
                                      className="text-gray-400"
                                    />
                                  ) : null}
                                </span>
                              </button>
                              <div className="shrink-0 text-right">
                                <div className="tnum text-[0.9375rem] font-bold text-gray-900">
                                  {formatCurrency(e.total_incl_vat)}
                                </div>
                                {compare && Number(e.quoted_amount) > 0 ? (
                                  <div className="tnum text-2xs text-gray-400">
                                    {MONEY.committed.label}{" "}
                                    {formatCurrency(Number(e.quoted_amount))}
                                  </div>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <StatusChip
                                pay={pay}
                                entry={e}
                                onClick={() => openStatus(e)}
                              />
                              {statusFlag(e, pay) ? (
                                <span className="text-2xs text-gray-400">
                                  {statusFlag(e, pay)}
                                </span>
                              ) : null}
                              <div className="ml-auto flex items-center gap-1.5">
                                {pay === "Unpaid" || pay === "Partial" ? (
                                  <button
                                    type="button"
                                    className="btn btn-sm bg-emerald-600 text-white active:bg-emerald-800"
                                    onClick={() => openStatus(e, true)}
                                  >
                                    {payLabel(pay)}
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label="More actions"
                                  className="btn-icon h-9 min-h-0 w-9 min-w-0 border border-gray-200"
                                  onClick={() => setSheetFor(e)}
                                >
                                  <Icon name="more" size={16} />
                                </button>
                              </div>
                            </div>

                            {open ? (
                              <div className="mt-3 rounded-xl bg-gray-100 p-3">
                                {details(e, pay)}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="card">
                  <h3 className="eyebrow mb-3">
                    Totals · {filtered.length}{" "}
                    {filtered.length === 1 ? "entry" : "entries"}
                  </h3>
                  <dl className="grid grid-cols-2 gap-2.5">
                    <TotalCell
                      label={MONEY.committed.label}
                      value={totals.quoted}
                    />
                    <TotalCell label={MONEY.cost.label} value={totals.actual} />
                    <TotalCell label={MONEY.paid.label} value={totals.paid} />
                    <TotalCell
                      label={MONEY.owed.label}
                      value={totals.remaining}
                      tone={totals.remaining > 0.001 ? "bad" : "good"}
                    />
                  </dl>
                </div>
              </div>

              {/* ---------------- Desktop ---------------- */}
              <div className="card hidden sm:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                      <th className="pb-2.5 pr-3">Description</th>
                      <th className="pb-2.5 pr-3">Category</th>
                      <th
                        className="pb-2.5 pr-3 text-right"
                        title={
                          compare
                            ? `${MONEY.committed.hint} → ${MONEY.cost.hint}`
                            : MONEY.cost.hint
                        }
                      >
                        {compare
                          ? `${MONEY.committed.label} → ${MONEY.cost.label}`
                          : MONEY.cost.label}
                      </th>
                      <th className="pb-2.5 pr-3 text-right" title={MONEY.paid.hint}>
                        {MONEY.paid.label}
                      </th>
                      <th className="pb-2.5 pr-3">Status</th>
                      <th className="w-10 pb-2.5" />
                    </tr>
                  </thead>

                  {groups.map((g) => (
                    <tbody key={g.week} className="divide-y divide-gray-200/70">
                      <tr>
                        {/* `sticky` has to sit on the cell, not the row —
                            position: sticky on a <tr> is ignored. */}
                        <th
                          colSpan={6}
                          scope="colgroup"
                          className="sticky top-0 z-10 bg-gray-100/95 px-2 py-1.5 text-left text-xs font-medium text-gray-600 backdrop-blur"
                        >
                          Week {g.week} · {MONEY.cost.label}{" "}
                          {formatCurrency(g.cost)} · {MONEY.owed.label}{" "}
                          {formatCurrency(g.owed)}
                        </th>
                      </tr>
                      {g.items.map(({ e, pay }) => {
                        const open = expanded.has(e.id);
                        return (
                          <React.Fragment key={e.id}>
                            <tr className="align-top">
                              <td className="py-2.5 pr-3">
                                <div className="flex items-start gap-2.5">
                                  <RowKind invoice={isInvoice(e)} />
                                  <button
                                    type="button"
                                    className="min-w-0 text-left"
                                    aria-expanded={open}
                                    onClick={() => toggleExpanded(e.id)}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <span className="font-semibold text-gray-900">
                                        {e.description}
                                      </span>
                                      {isInvoice(e) ? (
                                        <Badge label="Invoice" />
                                      ) : null}
                                      <Icon
                                        name={open ? "chevronUp" : "chevronDown"}
                                        size={14}
                                        className="shrink-0 text-gray-300"
                                      />
                                    </span>
                                    <span className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                      {metaLine(e)}
                                      {e.receipt_url ? (
                                        <Icon name="link" size={11} />
                                      ) : null}
                                    </span>
                                  </button>
                                </div>
                              </td>
                              <td className="py-2.5 pr-3 text-gray-600">{e.category ?? "—"}</td>
                              <td className="tnum py-2.5 pr-3 text-right">
                                {compare ? (
                                  <VarianceCell e={e} />
                                ) : (
                                  <span className="font-semibold text-gray-900">
                                    {formatCurrency(e.total_incl_vat)}
                                  </span>
                                )}
                              </td>
                              <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                                {formatCurrency(Number(e.paid_amount))}
                              </td>
                              <td className="py-2.5 pr-3">
                                <StatusChip
                                  pay={pay}
                                  entry={e}
                                  onClick={() => openStatus(e)}
                                />
                                {statusFlag(e, pay) ? (
                                  <p className="mt-0.5 text-2xs text-gray-400">
                                    {statusFlag(e, pay)}
                                  </p>
                                ) : null}
                              </td>
                              <td className="py-2.5">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* One primary affordance per row: settle
                                      what is owed. Everything else is behind
                                      the menu. */}
                                  {pay === "Unpaid" || pay === "Partial" ? (
                                    <button
                                      type="button"
                                      className="btn btn-sm bg-emerald-600 text-white hover:bg-emerald-700"
                                      onClick={() => openStatus(e, true)}
                                    >
                                      {payLabel(pay)}
                                    </button>
                                  ) : null}
                                  <div className="relative">
                                    <button
                                      type="button"
                                      aria-label="More actions"
                                      aria-expanded={menuFor === e.id}
                                      className="btn-icon h-9 min-h-0 w-9 min-w-0 hover:bg-gray-100"
                                      onClick={() =>
                                        setMenuFor((m) =>
                                          m === e.id ? null : e.id
                                        )
                                      }
                                    >
                                      <Icon name="more" size={16} />
                                    </button>
                                    {menuFor === e.id ? (
                                      <>
                                        <div
                                          className="fixed inset-0 z-20"
                                          aria-hidden
                                          onClick={closeMenus}
                                        />
                                        <div className="absolute right-0 z-30 mt-1 w-48 animate-pop-in rounded-2xl border border-gray-200/80 bg-white p-1.5 text-left shadow-pop">
                                          {actionsFor(e).map((a) => (
                                            <React.Fragment key={a.key}>
                                              {a.danger ? (
                                                <div className="my-1 divider" />
                                              ) : null}
                                              {a.href ? (
                                                <Link
                                                  href={a.href}
                                                  className="block rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                                                  onClick={closeMenus}
                                                >
                                                  {a.label}
                                                </Link>
                                              ) : (
                                                <button
                                                  type="button"
                                                  className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-gray-100 ${
                                                    a.danger
                                                      ? "text-red-600"
                                                      : "text-gray-700"
                                                  }`}
                                                  onClick={() => {
                                                    closeMenus();
                                                    a.onClick?.();
                                                  }}
                                                >
                                                  {a.label}
                                                </button>
                                              )}
                                            </React.Fragment>
                                          ))}
                                        </div>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                            </tr>
                            {open ? (
                              <tr>
                                <td colSpan={6} className="bg-gray-50 px-4 py-3.5">
                                  {details(e, pay)}
                                </td>
                              </tr>
                            ) : null}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  ))}

                  <tfoot>
                    <tr className="border-t-2 border-gray-300 font-bold text-gray-900">
                      <td className="py-2.5 pr-3" colSpan={2}>
                        Totals ({filtered.length}{" "}
                        {filtered.length === 1 ? "entry" : "entries"})
                      </td>
                      <td className="tnum py-2.5 pr-3 text-right">
                        {compare ? (
                          <div>
                            <div className="text-xs font-medium text-gray-400">
                              {formatCurrency(totals.quoted)}
                            </div>
                            <div>{formatCurrency(totals.actual)}</div>
                          </div>
                        ) : (
                          formatCurrency(totals.actual)
                        )}
                      </td>
                      <td className="tnum py-2.5 pr-3 text-right">
                        {formatCurrency(totals.paid)}
                      </td>
                      {/* Owed has no column of its own any more — it is
                          Cost − Paid — but it is the figure the totals row
                          exists to give. */}
                      <td className="tnum py-2.5 pr-3" colSpan={2}>
                        <span className="text-xs font-medium text-gray-500">
                          {MONEY.owed.label}{" "}
                        </span>
                        {formatCurrency(totals.remaining)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* Mobile action sheet — the same actions as the desktop menu. */}
      <Sheet
        open={Boolean(sheetFor)}
        onClose={closeMenus}
        size="sm"
        title={sheetFor?.description ?? ""}
        description={
          sheetFor
            ? `${isInvoice(sheetFor) ? "Invoice" : "Expense"} · ${metaLine(sheetFor)}`
            : undefined
        }
      >
        <div className="-mx-2">
          {(sheetFor ? actionsFor(sheetFor) : []).map((a) => (
            <React.Fragment key={a.key}>
              {a.danger ? <div className="mx-3 my-1.5 divider" /> : null}
              {a.href ? (
                <Link
                  href={a.href}
                  className="flex min-h-touch w-full items-center gap-3 rounded-xl px-3 py-3 text-[0.9375rem] font-medium text-gray-800 transition active:bg-gray-100"
                  onClick={closeMenus}
                >
                  {a.label}
                </Link>
              ) : (
                <button
                  type="button"
                  className={`flex min-h-touch w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[0.9375rem] font-medium transition active:bg-gray-100 ${
                    a.danger ? "text-red-600" : "text-gray-800"
                  }`}
                  onClick={() => {
                    closeMenus();
                    a.onClick?.();
                  }}
                >
                  {a.label}
                </button>
              )}
            </React.Fragment>
          ))}
        </div>
      </Sheet>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={
          editing ? "Edit expense" : template ? "Repeat expense" : "Add expense"
        }
      >
        {/* Same white ground the standalone /expenses/new route gives it. */}
        <div className="card">
          <ExpenseForm
            key={editing?.id ?? template?.id ?? "new"}
            projectId={project.id}
            trades={trades}
            nextWeek={nextWeek}
            expense={editing ?? undefined}
            template={template ?? undefined}
            priorEntries={entries}
            invoiceLines={invoiceLines}
            onSaved={async () => {
              setDrawerOpen(false);
              await onChanged();
            }}
            onCancel={() => setDrawerOpen(false)}
          />
        </div>
      </Drawer>

      {/* The one status dialog. Status, amount, date and method together —
          whichever of them applies — and nothing is written until Save.
          Reuses ConfirmDialog rather than adding another modal primitive: its
          message is free-form, so the fields live in it. */}
      <ConfirmDialog
        open={Boolean(statusTarget)}
        title="Update status"
        confirmLabel="Save"
        form
        message={
          !statusTarget ? (
            ""
          ) : (
            <div className="space-y-4 text-left">
              {/* What is owed, stated as a figure rather than buried in a
                  sentence — it is the number the amount field is about. */}
              <div className="rounded-2xl bg-gray-100 px-4 py-3">
                <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                  {statusTarget.description}
                </p>
                {owedOn(statusTarget) > PAID_TOLERANCE ? (
                  <p className="mt-1 text-[0.8125rem] text-gray-600">
                    <span className="tnum font-bold text-red-600">
                      {formatCurrency(owedOn(statusTarget))}
                    </span>{" "}
                    still {MONEY.owed.label.toLowerCase()} of{" "}
                    <span className="tnum font-semibold">
                      {formatCurrency(statusTarget.total_incl_vat)}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-[0.8125rem] text-gray-600">
                    {MONEY.paid.label} in full —{" "}
                    <span className="tnum font-semibold">
                      {formatCurrency(statusTarget.total_incl_vat)}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="label" htmlFor="status-status">
                  Status
                </label>
                <Select
                  id="status-status"
                  title="Status"
                  value={statusForm.status}
                  options={EXPENSE_STATUSES.map((s) => ({ value: s, label: s }))}
                  onChange={(status) => {
                    setStatusForm((f) => ({
                      ...f,
                      status,
                      // Choosing Paid fills in what is left to pay; anything
                      // else leaves the amount alone so a part payment can be
                      // typed against In Progress.
                      amount:
                        status === "Paid" &&
                        statusTarget &&
                        owedOn(statusTarget) > 0
                          ? owedOn(statusTarget).toFixed(2)
                          : status === "Paid"
                            ? ""
                            : f.amount,
                    }));
                    setStatusError("");
                  }}
                />
              </div>

              {/* Money is only asked for when it can apply: something is still
                  owed, and the chosen status is one that money goes with. */}
              {owedOn(statusTarget) > PAID_TOLERANCE &&
              (statusForm.status === "Paid" ||
                statusForm.status === "In Progress") ? (
                <>
                  <div>
                    <label className="label" htmlFor="status-amount">
                      Amount paid now
                      {statusForm.status === "In Progress" ? " (optional)" : ""}
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-gray-400">
                        £
                      </span>
                      <input
                        id="status-amount"
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        className="input tnum pl-8 text-lg font-semibold"
                        value={statusForm.amount}
                        onChange={(ev) =>
                          setStatusForm((f) => ({ ...f, amount: ev.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label" htmlFor="status-date">
                      Paid date
                    </label>
                    <DatePicker
                      id="status-date"
                      title="Date the payment was made"
                      clearable={false}
                      value={statusForm.paid_date}
                      onChange={(paid_date) =>
                        setStatusForm((f) => ({ ...f, paid_date }))
                      }
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="status-method">
                      Payment method (optional)
                    </label>
                    <Select
                      id="status-method"
                      title="Payment method"
                      placeholder="Not recorded"
                      clearable
                      value={statusForm.payment_method}
                      onChange={(payment_method) =>
                        setStatusForm((f) => ({ ...f, payment_method }))
                      }
                      options={PAYMENT_METHODS.map((p) => ({ value: p, label: p }))}
                    />
                  </div>
                </>
              ) : null}

              {statusError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
                  {statusError}
                </p>
              ) : null}
            </div>
          )
        }
        onConfirm={() => void submitStatus()}
        onCancel={() => {
          setStatusTarget(null);
          setStatusError("");
        }}
      />

      {/* Moving a row back to Planned / In Progress while money is recorded
          against it. */}
      <ConfirmDialog
        open={Boolean(clearTarget)}
        title={`Move back to ${clearTarget?.status ?? ""}`}
        confirmLabel={
          clearTarget && isInvoice(clearTarget.entry)
            ? "Change status"
            : "Clear payment"
        }
        message={
          !clearTarget ? (
            ""
          ) : isInvoice(clearTarget.entry) ? (
            <>
              This invoice has {formatCurrency(Number(clearTarget.entry.paid_amount))}{" "}
              paid against it. Changing the status leaves those payments in
              place — an invoice&rsquo;s payments are separate records, and they
              are removed on the invoice itself.
            </>
          ) : (
            <>
              &ldquo;{clearTarget.entry.description}&rdquo; has{" "}
              {formatCurrency(Number(clearTarget.entry.paid_amount))} paid
              {clearTarget.entry.paid_date
                ? ` on ${fmtDate(clearTarget.entry.paid_date)}`
                : ""}
              . Clear the paid amount and date as well?
            </>
          )
        }
        onConfirm={() => {
          const t = clearTarget;
          setClearTarget(null);
          if (t) void updateStatus(t.entry, t.status, !isInvoice(t.entry));
        }}
        onCancel={() => setClearTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget && isInvoice(deleteTarget)
            ? "Delete invoice"
            : "Delete expense"
        }
        danger
        confirmLabel="Delete"
        message={
          !deleteTarget ? (
            ""
          ) : isInvoice(deleteTarget) ? (
            <>
              Delete the invoice &ldquo;{deleteTarget.description}&rdquo;? Its
              lines and payments go with it, and every figure derived from them
              — every Analysis pivot — drops it.
            </>
          ) : (
            <>Delete &ldquo;{deleteTarget.description}&rdquo;?</>
          )
        }
        onConfirm={() => {
          if (deleteTarget) doDelete(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
