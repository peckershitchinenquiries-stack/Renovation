"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import {
  formatCurrency,
  paidState,
  PAID_TOLERANCE,
  type PaidState,
} from "@/lib/calculations";
import { round2 } from "@/lib/purchases";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
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

const EMPTY_FILTERS = {
  week_from: "",
  week_to: "",
  category: "",
  trade: "",
  status: "",
  payment_method: "",
};

// Rows whose id looks like `inv:<uuid>` are invoices shown in the diary, not
// expense rows. They live in `purchases` and are edited on the invoice form —
// see the Expenses list's row actions and the PATCH handler for why.
const isInvoice = (e: { id: string }) => e.id.startsWith("inv:");
const purchaseIdOf = (e: { id: string }) => e.id.slice(4);

const todayISO = () => new Date().toISOString().slice(0, 10);

// The two statuses that mean "not paid". Choosing one of these on a row that
// already has money against it is the moment to ask whether the money should go
// too, rather than leaving a Planned row displaying a paid date.
const UNPAID_STATUSES = new Set(["Planned", "In Progress"]);

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

export default function ExpensesTab({
  project,
  entries,
  trades,
  invoiceLines,
  documentPurchaseIds,
  onChanged,
}: {
  project: Project;
  entries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  invoiceLines: InvoiceLineView[];
  documentPurchaseIds: string[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseEntryComputed | null>(null);
  // Set when repeating a past entry: prefills a new entry instead of editing.
  const [template, setTemplate] = useState<ExpenseEntryComputed | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntryComputed | null>(
    null
  );
  // The row being paid, and the payment being described. Nothing is written
  // until the dialog is submitted — pressing "Mark Paid" used to post a payment
  // dated today without ever asking.
  const [payTarget, setPayTarget] = useState<ExpenseEntryComputed | null>(null);
  const [payForm, setPayForm] = useState({
    paid_date: todayISO(),
    amount: "",
    payment_method: "",
  });
  const [payError, setPayError] = useState("");
  // Moving a paid row back to Planned / In Progress: the status and the money
  // have to be decided together, or the row keeps displaying a payment it no
  // longer claims to have had.
  const [clearTarget, setClearTarget] = useState<{
    entry: ExpenseEntryComputed;
    status: string;
  } | null>(null);

  // The Expenses tab is the week-by-week diary: it shows only 'diary' rows
  // (File 1 + anything added in-app). Imported 'ledger' rows (File 2) live in
  // the Trades and Materials & Suppliers tabs instead.
  const diaryEntries = useMemo(
    () => entries.filter((e) => e.source !== "ledger"),
    [entries]
  );

  const nextWeek = useMemo(() => {
    const max = diaryEntries.reduce((m, e) => Math.max(m, e.week_number), 0);
    return max + 1;
  }, [diaryEntries]);

  const activeFilterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length,
    [filters]
  );

  const filtered = useMemo(() => {
    return diaryEntries.filter((e) => {
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
  }, [diaryEntries, filters]);

  const withDocument = useMemo(
    () => new Set(documentPurchaseIds),
    [documentPurchaseIds]
  );

  /**
   * The row's description — a link to the original invoice document when, and
   * only when, one is actually stored.
   *
   * Manual expenses and invoices that were typed in rather than uploaded have
   * no file, so they stay plain text: a link that opens nothing, or a greyed-out
   * one, both read as "something is broken here" when nothing is.
   *
   * The href is this project's document route, never a signed URL. Signing at
   * render time would bake in an expiry the moment the page loaded; the route
   * signs when the link is followed instead.
   */
  const description = (e: ExpenseEntryComputed, className: string) => {
    if (!isInvoice(e) || !withDocument.has(purchaseIdOf(e)))
      return <span className={className}>{e.description}</span>;
    return (
      <a
        href={`/api/projects/${project.id}/purchases/${purchaseIdOf(e)}/document`}
        target="_blank"
        rel="noopener noreferrer"
        title="Open the original invoice"
        className={`${className} text-brand underline decoration-dotted underline-offset-2 hover:decoration-solid`}
      >
        {e.description}
      </a>
    );
  };

  // Every row paired with its derived payment state, computed once. The button
  // label, the status dropdown's behaviour and whether a paid date is shown at
  // all are all read off this one value, in the card list and the table alike.
  const rows = useMemo(
    () => filtered.map((e) => ({ e, pay: paidState(e) as PaidState })),
    [filtered]
  );

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
  // Log the same thing again — prefilled, so usually only the price changes.
  function openRepeat(e: ExpenseEntryComputed) {
    setEditing(null);
    setTemplate(e);
    setDrawerOpen(true);
  }

  // Open the payment dialog. The date defaults to today for every row: this is
  // the date the money moved, which for an invoice is emphatically not the
  // document's own date — paying a three-month-old invoice today must not
  // record the payment three months ago.
  function openPay(e: ExpenseEntryComputed) {
    const outstanding = round2(e.total_incl_vat - Number(e.paid_amount));
    setPayForm({
      paid_date: todayISO(),
      amount: outstanding > 0 ? outstanding.toFixed(2) : "",
      payment_method: e.payment_method ?? "",
    });
    setPayError("");
    setPayTarget(e);
  }

  async function submitPay() {
    const e = payTarget;
    if (!e) return;

    const amount = round2(Number(payForm.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      setPayError("Enter an amount greater than zero.");
      return;
    }
    if (!payForm.paid_date) {
      setPayError("Choose the date the payment was made.");
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
      paid_date: payForm.paid_date,
    };
    // Only sent when chosen, so leaving it blank does not wipe a method that is
    // already recorded on the row.
    if (payForm.payment_method) body.payment_method = payForm.payment_method;

    try {
      await apiFetch(`/api/projects/${project.id}/expenses/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast(settled ? "Marked as paid" : "Payment recorded", "success");
      setPayTarget(null);
      await onChanged();
    } catch (err) {
      // Left open rather than dismissed, so the amount can be corrected — the
      // commonest failure here is over-paying an invoice, which the handler
      // rejects with an explanation.
      setPayError(err instanceof Error ? err.message : "Update failed");
    }
  }

  // The status dropdown and the Mark Paid button are the same path: choosing
  // Paid on a row that has not been paid opens the payment dialog rather than
  // silently labelling it Paid with no money against it.
  function requestStatus(e: ExpenseEntryComputed, newStatus: string) {
    if (newStatus === e.status) return;
    if (newStatus === "Paid" && paidState(e) !== "Paid") {
      openPay(e);
      return;
    }
    if (UNPAID_STATUSES.has(newStatus) && hasPaymentData(e)) {
      setClearTarget({ entry: e, status: newStatus });
      return;
    }
    void updateStatus(e, newStatus);
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

  const rowActions = (e: ExpenseEntryComputed, pay: PaidState) => (
    <>
      {/* Offered while anything is still owed, so a part-paid invoice can be
          settled without opening it — and never on a row that is already
          settled or cancelled. */}
      {pay === "Unpaid" || pay === "Partial" ? (
        <button
          type="button"
          className="text-emerald-700 hover:underline"
          onClick={() => openPay(e)}
        >
          {pay === "Partial" ? "Mark Fully Paid" : "Mark Paid"}
        </button>
      ) : null}
      {isInvoice(e) ? (
        // An invoice's supplier, lines and amounts are properties of the
        // document, and only the invoice form can change them without leaving
        // the header disagreeing with the lines it is made of.
        <Link
          href={`/projects/${project.id}/purchases/${purchaseIdOf(e)}/edit?returnTo=${encodeURIComponent(
            `/projects/${project.id}?tab=expenses`
          )}`}
          className="text-brand hover:underline"
          aria-label="Edit invoice"
        >
          Edit
        </Link>
      ) : (
        <>
          <button
            type="button"
            className="text-gray-600 hover:underline"
            onClick={() => openRepeat(e)}
          >
            Repeat
          </button>
          <button
            type="button"
            className="text-brand hover:underline"
            aria-label="Edit expense"
            onClick={() => openEdit(e)}
          >
            Edit
          </button>
        </>
      )}
      <button
        type="button"
        className="text-red-600 hover:underline"
        onClick={() => setDeleteTarget(e)}
      >
        Delete
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      {/* Action bar — Add is always reachable, filters collapse on mobile. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-secondary sm:hidden"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
        </button>
        <button type="button" className="btn-primary ml-auto" onClick={openAdd}>
          + Add Expense
        </button>
      </div>

      <div
        className={`card flex-wrap items-end gap-3 ${
          filtersOpen ? "flex" : "hidden"
        } sm:flex`}
      >
        <div>
          <label className="label">Week from</label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className="input w-24"
            value={filters.week_from}
            onChange={(e) =>
              setFilters((f) => ({ ...f, week_from: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="label">Week to</label>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className="input w-24"
            value={filters.week_to}
            onChange={(e) =>
              setFilters((f) => ({ ...f, week_to: e.target.value }))
            }
          />
        </div>
        <div>
          <label className="label">Category</label>
          <select
            className="input w-36"
            value={filters.category}
            onChange={(e) =>
              setFilters((f) => ({ ...f, category: e.target.value }))
            }
          >
            <option value="">All</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Trade</label>
          <select
            className="input w-36"
            value={filters.trade}
            onChange={(e) => setFilters((f) => ({ ...f, trade: e.target.value }))}
          >
            <option value="">All</option>
            {trades.map((t) => (
              <option key={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input w-36"
            value={filters.status}
            onChange={(e) =>
              setFilters((f) => ({ ...f, status: e.target.value }))
            }
          >
            <option value="">All</option>
            {EXPENSE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Payment</label>
          <select
            className="input w-36"
            value={filters.payment_method}
            onChange={(e) =>
              setFilters((f) => ({ ...f, payment_method: e.target.value }))
            }
          >
            <option value="">All</option>
            {PAYMENT_METHODS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setFilters(EMPTY_FILTERS)}
        >
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          description="Add an expense here for anything you paid for without an invoice. Invoices you log appear in this list too, marked as invoices."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={openAdd}>
                Add Expense
              </button>
              <Link href="/invoices" className="btn-secondary">
                Log an invoice
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {/* Mobile: one card per entry. */}
          <ul className="space-y-2 sm:hidden">
            {rows.map(({ e, pay }) => (
              <li key={e.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1">
                      {e.receipt_url ? (
                        <button
                          type="button"
                          title="View receipt"
                          onClick={() => openReceipt(e)}
                          className="text-gray-400"
                        >
                          📎
                        </button>
                      ) : null}
                      {description(e, "font-medium")}
                      {isInvoice(e) && <Badge label="Invoice" />}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Week {e.week_number}
                      {e.category ? ` · ${e.category}` : ""}
                      {e.supplier ? ` · ${e.supplier}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">
                      {formatCurrency(e.total_incl_vat)}
                    </div>
                    <select
                      className="input mt-1 text-xs py-0.5 px-2 h-auto"
                      value={e.status}
                      onChange={(ev) => requestStatus(e, ev.target.value)}
                    >
                      {EXPENSE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <dl className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs text-gray-500">
                  <div>
                    <dt>Quoted</dt>
                    <dd className="text-gray-900">
                      {formatCurrency(Number(e.quoted_amount))}
                    </dd>
                  </div>
                  <div>
                    <dt>Paid</dt>
                    <dd className="text-gray-900">
                      {formatCurrency(Number(e.paid_amount))}
                    </dd>
                  </div>
                  <div>
                    <dt>Remaining</dt>
                    <dd className="text-gray-900">
                      {formatCurrency(e.remaining)}
                    </dd>
                  </div>
                </dl>

                {/* Nothing paid means nothing to date: a row that has never
                    been paid never shows a paid date, however old the column
                    value is. Same rule as the table's Date Paid cell. */}
                {pay !== "Unpaid" && e.paid_date ? (
                  <p className="mt-1 text-xs text-gray-400">
                    Paid {fmtDate(e.paid_date)}
                    {e.payment_method ? ` · ${e.payment_method}` : ""}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap gap-3 border-t border-gray-100 pt-2 text-sm">
                  {rowActions(e, pay)}
                </div>
              </li>
            ))}
          </ul>

          {/* Mobile totals for the current filter. */}
          <div className="card p-3 text-sm sm:hidden">
            <h3 className="mb-2 text-xs font-semibold uppercase text-gray-500">
              Totals ({filtered.length}{" "}
              {filtered.length === 1 ? "entry" : "entries"})
            </h3>
            <dl className="grid grid-cols-2 gap-2">
              <div className="flex justify-between">
                <dt className="text-gray-500">Quoted</dt>
                <dd className="font-medium">{formatCurrency(totals.quoted)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Actual</dt>
                <dd className="font-medium">{formatCurrency(totals.actual)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Paid</dt>
                <dd className="font-medium">{formatCurrency(totals.paid)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Remaining</dt>
                <dd className="font-medium">
                  {formatCurrency(totals.remaining)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Desktop: full table. */}
          <div className="card hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-gray-500">
                  <th className="py-2 pr-2">Wk</th>
                  <th className="py-2 pr-2">Description</th>
                  <th className="py-2 pr-2">Category</th>
                  <th className="py-2 pr-2">Trade</th>
                  <th className="py-2 pr-2">Notes</th>
                  <th className="py-2 pr-2 text-right">Quoted</th>
                  <th className="py-2 pr-2 text-right">Actual</th>
                  <th className="py-2 pr-2 text-right">Paid</th>
                  <th className="py-2 pr-2 text-right">Remaining</th>
                  <th className="py-2 pr-2">Date Paid</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ e, pay }) => (
                  <tr key={e.id} className="align-top">
                    <td className="py-2 pr-2">{e.week_number}</td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-1">
                        {e.receipt_url ? (
                          <button
                            type="button"
                            title="View receipt"
                            onClick={() => openReceipt(e)}
                            className="text-gray-400 hover:text-brand"
                          >
                            📎
                          </button>
                        ) : null}
                        {description(e, "")}
                        {isInvoice(e) && <Badge label="Invoice" />}
                      </div>
                      {e.supplier ? (
                        <p className="text-xs text-gray-400">{e.supplier}</p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">{e.category ?? "—"}</td>
                    <td className="py-2 pr-2">{e.trade ?? "—"}</td>
                    <td className="py-2 pr-2 max-w-xs text-xs text-gray-500">
                      {e.notes || "—"}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(Number(e.quoted_amount))}
                    </td>
                    <td className="py-2 pr-2 text-right font-medium">
                      {formatCurrency(e.total_incl_vat)}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(Number(e.paid_amount))}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      {formatCurrency(e.remaining)}
                    </td>
                    <td className="py-2 pr-2 whitespace-nowrap">
                      {/* A row with nothing paid against it has no paid date,
                          whatever the column happens to hold. */}
                      {pay === "Unpaid" ? "—" : fmtDate(e.paid_date)}
                      {pay !== "Unpaid" && e.payment_method ? (
                        <p className="text-xs text-gray-400">
                          {e.payment_method}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        className="input text-xs py-1 px-2 h-auto"
                        value={e.status}
                        onChange={(ev) => requestStatus(e, ev.target.value)}
                      >
                        {EXPENSE_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex justify-end gap-2 text-xs">
                        {rowActions(e, pay)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="py-2 pr-2" colSpan={5}>
                    Totals
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {formatCurrency(totals.quoted)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {formatCurrency(totals.actual)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {formatCurrency(totals.paid)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {formatCurrency(totals.remaining)}
                  </td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={
          editing ? "Edit expense" : template ? "Repeat expense" : "Add expense"
        }
      >
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
      </Drawer>

      {/* Record a payment. Reuses ConfirmDialog rather than adding another
          modal primitive — its message is free-form, so the fields live in it
          and nothing is written until Save. */}
      <ConfirmDialog
        open={Boolean(payTarget)}
        title={
          payTarget && paidState(payTarget) === "Partial"
            ? "Mark fully paid"
            : "Mark paid"
        }
        confirmLabel="Save payment"
        message={
          !payTarget ? (
            ""
          ) : (
            <div className="space-y-3">
              <p>
                <span className="font-medium text-gray-900">
                  {payTarget.description}
                </span>
                <br />
                {formatCurrency(
                  round2(
                    payTarget.total_incl_vat - Number(payTarget.paid_amount)
                  )
                )}{" "}
                still owed of {formatCurrency(payTarget.total_incl_vat)}.
              </p>
              <div>
                <label className="label" htmlFor="pay-date">
                  Paid date
                </label>
                <input
                  id="pay-date"
                  type="date"
                  className="input"
                  value={payForm.paid_date}
                  onChange={(ev) =>
                    setPayForm((f) => ({ ...f, paid_date: ev.target.value }))
                  }
                />
              </div>
              <div>
                <label className="label" htmlFor="pay-amount">
                  Amount paid now
                </label>
                <input
                  id="pay-amount"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="input"
                  value={payForm.amount}
                  onChange={(ev) =>
                    setPayForm((f) => ({ ...f, amount: ev.target.value }))
                  }
                />
              </div>
              <div>
                <label className="label" htmlFor="pay-method">
                  Payment method (optional)
                </label>
                <select
                  id="pay-method"
                  className="input"
                  value={payForm.payment_method}
                  onChange={(ev) =>
                    setPayForm((f) => ({
                      ...f,
                      payment_method: ev.target.value,
                    }))
                  }
                >
                  <option value="">Not recorded</option>
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              {payError ? (
                <p className="text-sm text-red-600">{payError}</p>
              ) : null}
            </div>
          )
        }
        onConfirm={() => void submitPay()}
        onCancel={() => {
          setPayTarget(null);
          setPayError("");
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
              — Trades, Materials, Suppliers and the Price Tracker — drops it.
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
