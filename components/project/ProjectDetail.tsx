"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import { computeEntries, formatCurrency } from "@/lib/calculations";
import {
  buildSummary,
  buildByWeek,
  buildByCategory,
  buildTrades,
  buildMaterialLedger,
  buildPriceHistory,
  buildPriceAlerts,
} from "@/lib/summary";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import OverviewTab from "./OverviewTab";
import ExpensesTab from "./ExpensesTab";
import TradesTab from "./TradesTab";
import MaterialsTab from "./MaterialsTab";
import PricesTab from "./PricesTab";
import type {
  Project,
  ExpenseEntry,
  ExpenseEntryComputed,
  TradeLookup,
  ProjectWeek,
} from "@/types";

type Tab = "overview" | "expenses" | "trades" | "materials" | "prices";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "expenses", label: "Expenses" },
  { key: "trades", label: "Trades & Labour" },
  { key: "materials", label: "Materials & Suppliers" },
  { key: "prices", label: "Price Tracker" },
];

export default function ProjectDetail({
  project,
  initialEntries,
  trades,
  initialWeeks,
}: {
  project: Project;
  initialEntries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  initialWeeks: ProjectWeek[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [entries, setEntries] = useState<ExpenseEntryComputed[]>(initialEntries);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const reloadEntries = useCallback(async () => {
    const raw = await apiFetch<ExpenseEntry[]>(
      `/api/projects/${project.id}/expenses`
    );
    // The API already returns computed entries, but recompute defensively.
    setEntries(computeEntries(raw as ExpenseEntry[]));
  }, [project.id]);

  // Overview reflects the week-by-week Expenses diary only (source !== 'ledger'),
  // so its analytics cover the 15 diary weeks — not the imported File 2 ledger.
  // Trades / Materials & Suppliers / Price Tracker still use the full data set.
  const diaryEntries = useMemo(
    () => entries.filter((e) => e.source !== "ledger"),
    [entries]
  );
  const summary = useMemo(
    () => buildSummary(project, diaryEntries),
    [project, diaryEntries]
  );
  const byWeek = useMemo(
    () => buildByWeek(diaryEntries, initialWeeks),
    [diaryEntries, initialWeeks]
  );
  const byCategory = useMemo(() => buildByCategory(diaryEntries), [diaryEntries]);
  const tradeSummary = useMemo(() => buildTrades(entries), [entries]);
  const materialLedger = useMemo(() => buildMaterialLedger(entries), [entries]);
  const priceHistory = useMemo(() => buildPriceHistory(entries), [entries]);
  const priceAlerts = useMemo(
    () => buildPriceAlerts(priceHistory),
    [priceHistory]
  );

  const budgetPct =
    summary.target_budget > 0
      ? Math.round((summary.forecast_total / summary.target_budget) * 100)
      : 0;
  const over = summary.variance > 0;
  const currentWeek = byWeek.length ? byWeek[byWeek.length - 1].week_number : 0;

  async function handleDelete() {
    try {
      await apiFetch(`/api/projects/${project.id}`, { method: "DELETE" });
      toast("Project deleted", "success");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  return (
    <div>
      {/* Persistent top bar */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <nav className="text-xs text-gray-400">
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>{" "}
              / {project.name}
            </nav>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-bold text-gray-900 sm:text-xl">
                {project.name}
              </h1>
              <Badge label={project.status} />
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              Week {currentWeek || "—"} · Spent{" "}
              {formatCurrency(summary.forecast_total)}
            </p>
          </div>

          <span
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
              over ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
            }`}
          >
            {budgetPct}% of budget
          </span>
        </div>

        {/* Actions wrap onto their own row on narrow screens. */}
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <div className="relative">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setExportOpen((o) => !o)}
            >
              Export ▾
            </button>
            {exportOpen && (
              <div
                className="absolute left-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                onMouseLeave={() => setExportOpen(false)}
              >
                <a
                  href={`/api/projects/${project.id}/export/pdf`}
                  className="block px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Export PDF
                </a>
                <a
                  href={`/api/projects/${project.id}/export/excel`}
                  className="block px-4 py-2 text-sm hover:bg-gray-50"
                >
                  Export Excel
                </a>
              </div>
            )}
          </div>

          <Link href={`/projects/${project.id}/edit`} className="btn-secondary">
            Edit
          </Link>
          <button
            type="button"
            className="btn-danger ml-auto"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-brand text-brand"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          byWeek={byWeek}
          byCategory={byCategory}
          priceAlerts={priceAlerts}
          onViewPrices={() => setTab("prices")}
        />
      )}
      {tab === "expenses" && (
        <ExpensesTab
          project={project}
          entries={entries}
          trades={trades}
          onChanged={reloadEntries}
        />
      )}
      {tab === "trades" && <TradesTab trades={tradeSummary} />}
      {tab === "materials" && <MaterialsTab rows={materialLedger} />}
      {tab === "prices" && <PricesTab items={priceHistory} />}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete project"
        danger
        confirmLabel="Delete project"
        confirmText={project.name}
        message={
          <>
            This permanently deletes <strong>{project.name}</strong> and all of
            its expense entries. Type the project name to confirm.
          </>
        }
        onConfirm={() => {
          setConfirmDelete(false);
          handleDelete();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

export { formatCurrency };
