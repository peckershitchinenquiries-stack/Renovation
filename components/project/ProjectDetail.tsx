"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import {
  buildSummary,
  buildByWeek,
  buildByCategory,
} from "@/lib/summary";
import {
  buildItemPriceAlerts,
  buildItemPriceRows,
  buildSupplierRows,
  buildTradeRows,
  labourLines,
  materialLines,
} from "@/lib/invoiceViews";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { InvoiceBanner } from "./InvoiceBanner";
import OverviewTab from "./OverviewTab";
import ExpensesTab from "./ExpensesTab";
import TradesTab from "./TradesTab";
import LabourTab from "./LabourTab";
import MaterialsTab from "./MaterialsTab";
import SuppliersTab from "./SuppliersTab";
import PricesTab from "./PricesTab";
import type {
  Project,
  ExpenseEntryComputed,
  InvoiceLineView,
  PurchaseComputed,
  TradeLookup,
  ProjectWeek,
  PurchaseTotals,
} from "@/types";

type Tab =
  | "overview"
  | "expenses"
  | "trades"
  | "labour"
  | "materials"
  | "suppliers"
  | "prices";

// "Trades & Labour" and "Materials & Suppliers" were each two questions sharing
// one screen. They are now four tabs, because the answers come from different
// shapes of data: Trades and Suppliers roll up whole invoices (payment is a
// document-level fact), while Labour and Materials list individual lines.
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "expenses", label: "Expenses" },
  { key: "trades", label: "Trades" },
  { key: "labour", label: "Labour" },
  { key: "materials", label: "Materials" },
  { key: "suppliers", label: "Suppliers" },
  { key: "prices", label: "Price Tracker" },
];
const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

// Tab selection is otherwise component-local state, so a plain link back to
// this page always landed on Overview. A `?tab=` query param lets a caller
// (e.g. the Expenses tab's invoice Edit link) say where to land instead —
// read once on mount, same as the default always was.
function initialTabFrom(value: string | null): Tab {
  return value && TAB_KEYS.has(value) ? (value as Tab) : "overview";
}

export default function ProjectDetail({
  project,
  initialEntries,
  trades,
  initialWeeks,
  invoiceTotals,
  invoiceLines,
  purchases,
  supplierNames,
  documentPurchaseIds,
}: {
  project: Project;
  initialEntries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  initialWeeks: ProjectWeek[];
  invoiceTotals: PurchaseTotals[];
  invoiceLines: InvoiceLineView[];
  purchases: PurchaseComputed[];
  supplierNames: Record<string, string>;
  // Invoices whose original photo or PDF is still stored. Kept out of the
  // entries array on purpose: it is a fact about the document, not about the
  // money, and reloadEntries below has no business carrying it.
  documentPurchaseIds: string[];
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    initialTabFrom(searchParams.get("tab"))
  );
  const [entries, setEntries] = useState<ExpenseEntryComputed[]>(initialEntries);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The server is the only thing that can rebuild the invoice-derived tabs, so
  // a change refetches the entry list AND asks Next to re-render the page. The
  // entry list arrives first and keeps the Expenses tab responsive; the refresh
  // catches everything else up a moment later.
  //
  // This endpoint returns diary entries and invoices merged, exactly as
  // getProjectBundle does. It used to return expense_entries alone, which is
  // why marking an invoice paid made the whole list vanish: the invoice rows
  // were simply not in the reply.
  const reloadEntries = useCallback(async () => {
    const raw = await apiFetch<ExpenseEntryComputed[]>(
      `/api/projects/${project.id}/expenses`
    );
    setEntries(raw);
    router.refresh();
  }, [project.id, router]);

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

  // The five invoice-driven tabs. All of them read purchase lines rather than
  // expense entries — see the header of lib/invoiceViews.ts for why.
  const supplierNameMap = useMemo(
    () => new Map(Object.entries(supplierNames)),
    [supplierNames]
  );
  const tradeRows = useMemo(
    () => buildTradeRows(purchases, invoiceLines, supplierNameMap),
    [purchases, invoiceLines, supplierNameMap]
  );
  const supplierRows = useMemo(
    () => buildSupplierRows(purchases, invoiceLines, supplierNameMap),
    [purchases, invoiceLines, supplierNameMap]
  );
  const materials = useMemo(() => materialLines(invoiceLines), [invoiceLines]);
  const labour = useMemo(() => labourLines(invoiceLines), [invoiceLines]);
  const priceRows = useMemo(
    () => buildItemPriceRows(invoiceLines),
    [invoiceLines]
  );
  const priceAlerts = useMemo(() => buildItemPriceAlerts(priceRows), [priceRows]);

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

          {/* The multi-line invoice screens live outside the five tabs: they
              read the transaction core rather than expense_entries, so they
              are a route of their own rather than a sixth tab (about.md §8.2). */}
          <Link
            href={`/projects/${project.id}/purchases`}
            className="btn-secondary"
          >
            Invoices
          </Link>

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

      {/* What has been invoiced against this project, above the tabs so it is
          visible from every one of them. */}
      {invoiceTotals.length > 0 && (
        <div className="mb-4">
          <InvoiceBanner
            totals={invoiceTotals}
            purchasesHref={`/projects/${project.id}/purchases`}
          />
        </div>
      )}

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
          invoiceLines={invoiceLines}
          documentPurchaseIds={documentPurchaseIds}
          onChanged={reloadEntries}
        />
      )}
      {tab === "trades" && <TradesTab projectId={project.id} rows={tradeRows} />}
      {tab === "labour" && (
        <LabourTab projectId={project.id} lines={labour} />
      )}
      {tab === "materials" && (
        <MaterialsTab projectId={project.id} lines={materials} />
      )}
      {tab === "suppliers" && (
        <SuppliersTab
          projectId={project.id}
          rows={supplierRows}
          lines={invoiceLines}
        />
      )}
      {tab === "prices" && (
        <PricesTab
          projectId={project.id}
          rows={priceRows}
          hasLines={invoiceLines.length > 0}
        />
      )}

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
