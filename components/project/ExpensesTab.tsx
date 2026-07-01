"use client";

import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { Badge } from "@/components/ui/Badge";
import { Drawer } from "@/components/ui/Drawer";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import ExpenseForm from "@/components/forms/ExpenseForm";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  type Project,
  type ExpenseEntryComputed,
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

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a stored 'YYYY-MM-DD' paid_date without timezone drift.
function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export default function ExpensesTab({
  project,
  entries,
  trades,
  onChanged,
}: {
  project: Project;
  entries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseEntryComputed | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseEntryComputed | null>(
    null
  );

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
  }, [entries, filters]);

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
    setDrawerOpen(true);
  }
  function openEdit(e: ExpenseEntryComputed) {
    setEditing(e);
    setDrawerOpen(true);
  }

  async function markPaid(e: ExpenseEntryComputed) {
    try {
      await apiFetch(`/api/projects/${project.id}/expenses/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "Paid",
          paid_amount: e.actual_amount,
          paid_date: e.paid_date || new Date().toISOString().slice(0, 10),
        }),
      });
      toast("Marked as paid", "success");
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
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/expenses/${e.id}/receipt`
      );
      window.open(url, "_blank", "noopener");
    } catch {
      toast("Could not open receipt", "error");
    }
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Week from</label>
          <input
            type="number"
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
        <div className="ml-auto">
          <button type="button" className="btn-primary" onClick={openAdd}>
            + Add Expense
          </button>
        </div>
      </div>

      {/* Table */}
      {entries.length === 0 ? (
        <EmptyState
          title="No expenses yet"
          description="Add your first expense entry for this project."
          action={
            <button className="btn-primary" onClick={openAdd}>
              Add Expense
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
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
              {filtered.map((e) => (
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
                      <span>{e.description}</span>
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
                    {fmtDate(e.paid_date)}
                    {e.payment_method ? (
                      <p className="text-xs text-gray-400">{e.payment_method}</p>
                    ) : null}
                  </td>
                  <td className="py-2 pr-2">
                    <Badge label={e.status} />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex justify-end gap-2 text-xs">
                      {e.status !== "Paid" && e.status !== "Cancelled" ? (
                        <button
                          type="button"
                          className="text-emerald-700 hover:underline"
                          onClick={() => markPaid(e)}
                        >
                          Mark Paid
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="text-brand hover:underline"
                        onClick={() => openEdit(e)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-red-600 hover:underline"
                        onClick={() => setDeleteTarget(e)}
                      >
                        Delete
                      </button>
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
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? "Edit expense" : "Add expense"}
      >
        <ExpenseForm
          projectId={project.id}
          trades={trades}
          nextWeek={nextWeek}
          expense={editing ?? undefined}
          priorEntries={entries}
          onSaved={async () => {
            setDrawerOpen(false);
            await onChanged();
          }}
          onCancel={() => setDrawerOpen(false)}
        />
      </Drawer>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete expense"
        danger
        confirmLabel="Delete"
        message={
          deleteTarget ? (
            <>Delete &ldquo;{deleteTarget.description}&rdquo;?</>
          ) : (
            ""
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
