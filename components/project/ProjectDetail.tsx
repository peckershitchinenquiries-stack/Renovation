"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { ACTIVE_PURCHASE, retentionIsDue } from "@/lib/purchases";
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
import ScheduleTab from "@/components/schedule/ScheduleTab";
import { projectCostRollup, taskCostRows } from "@/lib/scheduleCosts";
import type {
  Contact,
  Project,
  ExpenseEntryComputed,
  InvoiceLineView,
  ProjectPurchaseRow,
  PurchaseComputed,
  TradeLookup,
  ProjectWeek,
  PurchaseTotals,
  ScheduleBundle,
} from "@/types";

type Tab = "overview" | "expenses" | "invoices" | "analysis" | "schedule";

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
  // The fifth tab. Five is one more than the four the 2026-08-28 collapse
  // settled on, and it is justified in the way the five retired ones were not:
  // those were one dataset (invoice lines) grouped five ways, which is a pivot
  // wearing a tab strip. This is a genuinely different dataset — work and time,
  // with its own tables and its own write path — and no screen sums it with
  // the others.
  { key: "schedule", label: "Schedule" },
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
  if (
    view === "trade" ||
    view === "supplier" ||
    view === "material" ||
    view === "price" ||
    view === "task"
  )
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
  scheduleBundle,
  openSnagCount = 0,
  openSafetySnagCount = 0,
  contacts = [],
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
  // Phases, tasks, dependencies, the current baseline and the recent revision
  // log. Null only when migration 0016 has not been run yet — the Schedule tab
  // then says so rather than rendering an empty list that looks like "no tasks".
  scheduleBundle: ScheduleBundle | null;
  /**
   * Open snags on this project (migration 0022). A count only — the list is
   * its own route. It is carried this far up because an open safety snag
   * should never need looking for, and zero when 0022 has not been run.
   */
  openSnagCount?: number;
  openSafetySnagCount?: number;
  /**
   * The people register (migration 0020), for the Schedule tab's assignee
   * picker. Empty when 0020 has not been run — the picker does not appear.
   */
  contacts?: Contact[];
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

  // Retention (migration 0019). Derived from the purchase rows the page has
  // already loaded, so there is no extra query, and computed here rather than
  // inside buildSummary — that function also serves hand-entered diary rows,
  // where retention does not exist as a concept.
  //
  // Both figures are zero on every project until somebody types a percentage
  // onto an invoice, which is exactly when they mean to.
  const retention = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = purchases.filter(ACTIVE_PURCHASE);
    return {
      held: active.reduce((sum, p) => sum + p.retention_held, 0),
      dueCount: active.filter((p) => retentionIsDue(p, today)).length,
    };
  }, [purchases]);

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

  // The fifth pivot: the same invoice lines, grouped by the task they were
  // tagged to. Computed here beside the other four so switching pivot costs
  // nothing, and empty until migration 0016 has been run.
  // The same task list the invoice form gets, for the cost form's task tag.
  // Cancelled work is left out: a new cost should not be filed against a job
  // that was called off.
  const taskRefs = useMemo(() => {
    if (!scheduleBundle) return [];
    const phaseNames = new Map(
      scheduleBundle.phases.map((p) => [p.id, p.name])
    );
    return scheduleBundle.tasks
      .filter((t) => t.status !== "Cancelled")
      .map((t) => ({
        id: t.id,
        name: t.name,
        phase_name: t.phase_id ? phaseNames.get(t.phase_id) ?? null : null,
        status: t.status,
      }));
  }, [scheduleBundle]);

  const costRollup = useMemo(
    () =>
      scheduleBundle
        ? projectCostRollup(
            scheduleBundle.tasks,
            invoiceLines,
            purchases,
            diaryEntries
          )
        : null,
    [scheduleBundle, invoiceLines, purchases, diaryEntries]
  );

  const taskRows = useMemo(
    () =>
      scheduleBundle
        ? taskCostRows(
            scheduleBundle.tasks,
            invoiceLines,
            purchases,
            diaryEntries
          )
        : [],
    [scheduleBundle, invoiceLines, purchases, diaryEntries]
  );

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

      {/* An open safety snag sits above the tabs, not inside one, because the
          person who needs to see it is whichever one they happened to open.
          Non-safety snags get a quieter line so the loud treatment keeps
          meaning something. */}
      {openSafetySnagCount > 0 ? (
        <Link
          href={`/projects/${project.id}/log?view=snags`}
          className="mt-4 flex items-center gap-3 rounded-2xl bg-red-50 p-4 ring-1 ring-inset ring-red-600/15"
        >
          <Icon name="alert" size={19} className="shrink-0 text-red-600" />
          <span className="min-w-0 flex-1 text-sm font-bold text-red-800">
            {openSafetySnagCount} open safety{" "}
            {openSafetySnagCount === 1 ? "snag" : "snags"}
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-red-400" />
        </Link>
      ) : openSnagCount > 0 ? (
        <Link
          href={`/projects/${project.id}/log?view=snags`}
          className="mt-4 flex items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 transition active:bg-gray-200"
        >
          <Icon name="hammer" size={18} className="shrink-0 text-gray-500" />
          <span className="min-w-0 flex-1 text-[0.8125rem] font-semibold text-gray-700">
            {openSnagCount} open {openSnagCount === 1 ? "snag" : "snags"}
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-gray-400" />
        </Link>
      ) : null}

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
          costRollup={costRollup}
          onViewTasks={() => {
            setView("task");
            setTab("analysis");
          }}
          retentionHeld={retention.held}
          retentionDueCount={retention.dueCount}
          onViewInvoicesForRetention={() => setTab("invoices")}
        />
      )}
      {tab === "expenses" && (
        <ExpensesTab
          project={project}
          entries={entries}
          trades={trades}
          invoiceLines={invoiceLines}
          tasks={taskRefs}
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
      {tab === "schedule" && (
        scheduleBundle ? (
          <ScheduleTab
            projectId={project.id}
            bundle={scheduleBundle}
            invoiceLines={invoiceLines}
            purchases={purchases}
            entries={diaryEntries}
            trades={trades}
            contacts={contacts}
            onShowUntagged={() => {
              setView("task");
              setTab("analysis");
            }}
          />
        ) : (
          <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
            <p className="text-sm font-bold text-amber-900">
              The schedule tables are not there yet
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
              Run <code>0016_schedule_core.sql</code>,{" "}
              <code>0017_task_cost_link.sql</code> and{" "}
              <code>0018_work_calendar.sql</code> in the Supabase SQL editor, in
              that order, and this tab will fill itself in. Migrations in this
              project are applied by hand — writing the file does not run it.
            </p>
          </div>
        )
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
          taskRows={taskRows}
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
          {/* The four Track B screens. They are routes rather than tabs on
              purpose: five tabs is already one more than the 2026-08-28
              collapse settled on, and none of these is another way of looking
              at the spend — which is what earns a tab. They are browsed
              occasionally, so one tap away is the right distance. */}
          <SheetAction
            icon="list"
            label="Log & snags"
            hint="Calls, site visits, decisions — and what needs putting right"
            href={`/projects/${project.id}/log`}
          />
          <SheetAction
            icon="receipt"
            label="Documents & photos"
            hint="Planning, certificates, drawings, the site timeline"
            href={`/projects/${project.id}/documents`}
          />
          <SheetAction
            icon="truck"
            label="Orders"
            hint="What you have ordered, and whether it arrived as billed"
            href={`/projects/${project.id}/orders`}
          />
          <SheetAction
            icon="edit"
            label="Variations"
            hint="What changed, why, and what it cost"
            href={`/projects/${project.id}/variations`}
          />
          <div className="my-1.5 mx-3 divider" />
          <SheetAction
            icon="settings"
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
