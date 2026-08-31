"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { MONEY } from "@/lib/vocabulary";
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
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { HeroStat } from "@/components/ui/StatCard";
import { Sheet } from "@/components/ui/Sheet";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import AddMenu, { type AddItem } from "./AddMenu";
import OverviewTab from "./OverviewTab";
import ExpensesTab from "./ExpensesTab";
import InvoicesTab from "./InvoicesTab";
import AnalysisTab, {
  type AnalysisView,
  type LineCategory,
} from "./AnalysisTab";
import type {
  Project,
  ExpenseEntryComputed,
  InvoiceLineView,
  ProjectPurchaseRow,
  PurchaseComputed,
  TradeLookup,
  ProjectWeek,
  PurchaseTotals,
} from "@/types";

type Tab = "overview" | "expenses" | "invoices" | "analysis";

// Seven tabs, four destinations.
//
// Trades, Labour, Materials, Suppliers and Price Tracker all read the same
// dataset — invoice lines and purchases, built in lib/invoiceViews.ts — grouped
// by a different column. Five tab stops for one `group by` is a pivot wearing a
// tab strip, so they are one Analysis screen with a pivot control. Invoices was
// the opposite problem: a separate route that left the tab context and needed a
// `?tab=` link to get back, so it has come in as a tab.
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  // The key stays "expenses" — `?tab=expenses` deep links from the invoice
  // edit form depend on it. Only the word on the strip changed: nobody calls
  // an invoice an expense, and this tab lists both.
  { key: "expenses", label: "Costs" },
  { key: "invoices", label: "Invoices" },
  { key: "analysis", label: "Analysis" },
];
const TAB_KEYS = new Set<string>(TABS.map((t) => t.key));

// The five retired tab keys, each mapped to the Analysis pivot it became.
// `?tab=labour` is in links that were saved before this change — a `returnTo`
// on a half-finished labour form, a bookmark — and a dead deep link that
// silently lands on Overview is worse than a redirect nobody notices.
const RETIRED: Record<string, { view: AnalysisView; category?: LineCategory }> = {
  trades: { view: "trade" },
  suppliers: { view: "supplier" },
  materials: { view: "material", category: "materials" },
  labour: { view: "material", category: "labour" },
  prices: { view: "price" },
};

// Tab selection is otherwise component-local state, so a plain link back to
// this page always landed on Overview. A `?tab=` query param lets a caller
// (e.g. the Costs tab's invoice Edit link) say where to land instead — read
// once on mount, same as the default always was.
function initialTabFrom(value: string | null): Tab {
  if (value && TAB_KEYS.has(value)) return value as Tab;
  if (value && RETIRED[value]) return "analysis";
  return "overview";
}

// `?view=` picks the Analysis pivot. It also accepts the retired tab keys, so
// `?tab=labour` alone still lands on the labour lines.
function initialViewFrom(tab: string | null, view: string | null): AnalysisView {
  const named = RETIRED[view ?? ""] ?? RETIRED[tab ?? ""];
  if (named) return named.view;
  if (view === "trade" || view === "supplier" || view === "material" || view === "price")
    return view;
  return "trade";
}

function initialCategoryFrom(tab: string | null, view: string | null): LineCategory {
  const named = RETIRED[view ?? ""] ?? RETIRED[tab ?? ""];
  return named?.category ?? "all";
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
  purchaseRows,
}: {
  project: Project;
  initialEntries: ExpenseEntryComputed[];
  trades: TradeLookup[];
  initialWeeks: ProjectWeek[];
  invoiceTotals: PurchaseTotals[];
  invoiceLines: InvoiceLineView[];
  purchases: PurchaseComputed[];
  supplierNames: Record<string, string>;
  // One row per invoice document, from getProjectPurchases — the same array the
  // standalone /purchases route renders. Fetched on the server beside the
  // bundle so the Invoices tab needs no client fetch of its own, and so
  // router.refresh() (which reloadEntries already calls) brings it up to date
  // after any change, exactly as it does for every other tab.
  purchaseRows: ProjectPurchaseRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() =>
    initialTabFrom(searchParams.get("tab"))
  );
  const [view, setView] = useState<AnalysisView>(() =>
    initialViewFrom(searchParams.get("tab"), searchParams.get("view"))
  );
  const [lineCategory, setLineCategory] = useState<LineCategory>(() =>
    initialCategoryFrom(searchParams.get("tab"), searchParams.get("view"))
  );
  const [entries, setEntries] = useState<ExpenseEntryComputed[]>(initialEntries);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Set by "+ Add → Cost", cleared by ExpensesTab the moment it opens the
  // drawer. The drawer stays inside ExpensesTab, which is where its trade list,
  // next week number and prior entries already live; hoisting it here would
  // drag all of that up with it. See ExpensesTab for why this is consumed
  // rather than left standing.
  const [addCostPending, setAddCostPending] = useState(false);

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
  // The Analysis pivots still use the full data set.
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

  // The four Analysis pivots. All of them read purchase lines rather than
  // expense entries — see the header of lib/invoiceViews.ts for why. They are
  // computed here rather than in the tab so switching pivot costs nothing.
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

  /**
   * What each item of the one "+ Add" control does.
   *
   * The three destinations are deliberately not the same shape, and this is the
   * only place that difference is allowed to show:
   *
   *   • Cost — a one-screen form, so it opens the drawer in place. Switch to
   *     the Costs tab first, so the new row lands somewhere visible rather than
   *     behind whatever tab happened to be open.
   *   • Invoice — the upload → review → commit flow, left exactly as it was.
   *     It is the one multi-step flow that earns its steps; only its entry
   *     point moved here. about.md §8.2.
   *   • Labour — its own route, and the same `returnTo` the Analysis labour
   *     pivot builds, so saving lands back on the lines you just added to.
   *     That route used to be reachable ONLY from the Labour empty state,
   *     which meant it disappeared as soon as the project had any labour.
   */
  function handleAdd(item: AddItem) {
    if (item === "cost") {
      setTab("expenses");
      setAddCostPending(true);
      return;
    }
    if (item === "invoice") {
      router.push("/invoices");
      return;
    }
    router.push(
      `/projects/${project.id}/labour/new?returnTo=${encodeURIComponent(
        `/projects/${project.id}?tab=analysis&view=labour`
      )}`
    );
  }

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
      {/*
        The header is the project's identity plus its tab strip, and nothing
        else. Everything that used to sit in the row below it — Export, Edit and
        a full-width red Delete — has moved into the "…" sheet: those are three
        rare actions that were taking up the most valuable strip of a phone
        screen, and one of them destroys the project.
      */}
      <PageHeader
        title={project.name}
        subtitle={
          <>
            Week {currentWeek || "—"} · {MONEY.cost.label}{" "}
            <span className="tnum font-semibold text-gray-700">
              {formatCurrency(summary.forecast_total)}
            </span>
          </>
        }
        backHref="/dashboard"
        backLabel="Back to projects"
        action={
          <>
            {/* Renders its own desktop dropdown here and its own fixed mobile
                FAB above the tab bar — see AddMenu.tsx. */}
            <AddMenu onSelect={handleAdd} />
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Project actions"
              className="btn-icon text-gray-600"
            >
              <Icon name="more" size={20} />
            </button>
          </>
        }
        below={
          <SegmentedControl
            fill
            label="Project section"
            value={tab}
            onChange={setTab}
            options={TABS.map((t) => ({ value: t.key, label: t.label }))}
          />
        }
      />

      {/* The headline figures, once, above the tabs — so the answer to "how is
          this project doing" does not depend on which tab you happen to be on.
          The invoice summary that used to sit here has moved into Overview as a
          single sentence; it was a subset of this Cost total dressed up as a
          separate set of figures, repeated on six tabs that were not about it. */}
      <HeroStat
        label={`${MONEY.cost.label} to date`}
        value={formatCurrency(summary.forecast_total)}
        sub={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge
              label={project.status}
              className="bg-white/15 text-white ring-white/20"
            />
            <span>
              {MONEY.owed.label}{" "}
              <span className="tnum font-semibold text-white">
                {formatCurrency(summary.remaining_to_pay)}
              </span>
            </span>
          </div>
        }
      >
        {summary.target_budget > 0 ? (
          <div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
              <div
                className={`h-full rounded-full ${over ? "bg-red-300" : "bg-white"}`}
                style={{ width: `${Math.min(Math.max(budgetPct, 2), 100)}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-white/70">
              <span className="font-bold text-white">{budgetPct}%</span> of{" "}
              {formatCurrency(summary.target_budget)} budget
              {over ? " — over" : ""}
            </p>
          </div>
        ) : null}
      </HeroStat>

      <div className="mt-5">

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          byWeek={byWeek}
          byCategory={byCategory}
          priceAlerts={priceAlerts}
          onViewPrices={() => {
            setView("price");
            setTab("analysis");
          }}
          invoiceTotals={invoiceTotals}
          onViewInvoices={() => setTab("invoices")}
        />
      )}
      {tab === "expenses" && (
        <ExpensesTab
          project={project}
          entries={entries}
          trades={trades}
          invoiceLines={invoiceLines}
          addRequested={addCostPending}
          onAddConsumed={() => setAddCostPending(false)}
          onChanged={reloadEntries}
        />
      )}
      {tab === "invoices" && (
        <InvoicesTab
          project={project}
          rows={purchaseRows}
          totals={invoiceTotals}
        />
      )}
      {tab === "analysis" && (
        <AnalysisTab
          projectId={project.id}
          view={view}
          onViewChange={setView}
          category={lineCategory}
          onCategoryChange={setLineCategory}
          tradeRows={tradeRows}
          supplierRows={supplierRows}
          allLines={invoiceLines}
          materials={materials}
          labour={labour}
          priceRows={priceRows}
        />
      )}
      </div>

      {/* Export / Edit / Delete. Rare, so they live one tap away rather than in
          the header — and Delete is last, quiet, and still gated by the
          type-the-name confirmation. */}
      <Sheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={project.name}
        description="Project actions"
        size="sm"
      >
        <div className="-mx-2">
          <SheetAction
            icon="edit"
            label="Edit project"
            hint="Name, status, budget and dates"
            href={`/projects/${project.id}/edit`}
          />
          <SheetAction
            icon="download"
            label="Export as PDF"
            hint="A printable summary of every cost"
            download={`/api/projects/${project.id}/export/pdf`}
          />
          <SheetAction
            icon="download"
            label="Export as Excel"
            hint="One row per entry, for spreadsheets"
            download={`/api/projects/${project.id}/export/excel`}
          />
          <div className="my-1.5 mx-3 divider" />
          <SheetAction
            icon="trash"
            tone="bad"
            label="Delete project"
            hint="Removes the project and every cost on it"
            onClick={() => {
              setMoreOpen(false);
              setConfirmDelete(true);
            }}
          />
        </div>
      </Sheet>

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

/**
 * One row of the project actions sheet.
 *
 * `download` renders a plain `<a>` rather than a `Link`: the export routes
 * stream a file back, and Next's client router would try to treat that as a
 * navigation.
 */
function SheetAction({
  icon,
  label,
  hint,
  href,
  download,
  onClick,
  tone = "neutral",
}: {
  icon: IconName;
  label: string;
  hint: string;
  href?: string;
  download?: string;
  onClick?: () => void;
  tone?: "neutral" | "bad";
}) {
  const body = (
    <>
      <IconTile name={icon} tone={tone === "bad" ? "bad" : "neutral"} size="lg" />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[0.9375rem] font-semibold ${
            tone === "bad" ? "text-red-700" : "text-gray-900"
          }`}
        >
          {label}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-gray-500">
          {hint}
        </span>
      </span>
      <Icon name="chevronRight" size={18} className="shrink-0 text-gray-300" />
    </>
  );

  const className =
    "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition active:bg-gray-100 hover:bg-gray-50";

  if (download)
    return (
      <a href={download} className={className}>
        {body}
      </a>
    );
  if (href)
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

export { formatCurrency };
