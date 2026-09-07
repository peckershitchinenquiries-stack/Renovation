"use client";

import { useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { MONEY, BUDGET } from "@/lib/vocabulary";
import { portfolioRollup, scheduleLabel, scheduleTone } from "@/lib/portfolio";
import { fmtDate } from "@/components/project/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { HeroStat } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { Fab } from "@/components/ui/Fab";
import PortfolioGantt from "@/components/schedule/PortfolioGantt";
import { expirySentence } from "@/lib/certifications";
import type { RetentionDueRow } from "@/lib/data";
import type {
  CertificationView,
  Project,
  ProjectHealth,
  ScheduleBundle,
} from "@/types";

/**
 * Home — the money view and the schedule view of the same portfolio.
 *
 * A segmented control rather than a fifth nav destination. The 2026-08-28
 * rewrite went from six nav items to four on purpose, and "how are my sites
 * doing on time" is not a different place from "how are my sites doing on
 * money" — it is the same list, answered on the other axis.
 *
 * The **budget bar is untouched** on the money view. It is correct, its
 * vocabulary is settled, and this change adds beside it rather than rewriting
 * it: a progress bar and a schedule chip, both of which are new information
 * rather than a new opinion about the old information.
 */

type View = "money" | "schedule";

export interface ProjectSpend {
  gross: number;
  paid: number;
  balance: number;
  count: number;
}

export default function DashboardScreen({
  projects,
  spentByProject,
  invoicedByProject,
  healths,
  bundles,
  expiringCertifications = [],
  retentionsDue = [],
}: {
  projects: Project[];
  spentByProject: Record<string, number>;
  invoicedByProject: Record<string, ProjectSpend>;
  // Empty when the schedule migrations have not been run. The schedule segment
  // then says so rather than showing an empty chart that reads as "no work".
  healths: ProjectHealth[];
  bundles: ScheduleBundle[];
  /**
   * Certificates that have lapsed or will within 30 days (migration 0020).
   *
   * Surfaced here, on the screen people actually open, because a compliance
   * date on a detail page is a compliance date nobody reads. Empty when 0020
   * has not been run.
   */
  expiringCertifications?: CertificationView[];
  /** Retentions past their agreed release date (migration 0019). */
  retentionsDue?: RetentionDueRow[];
}) {
  const [view, setView] = useState<View>("money");
  const certificateSentence = expirySentence(expiringCertifications);

  const healthById = new Map(healths.map((h) => [h.project_id, h]));
  const rollup = portfolioRollup(healths);

  const totalCost = projects.reduce(
    (sum, p) => sum + (spentByProject[p.id] ?? 0),
    0
  );
  const totalOwed = projects.reduce(
    (sum, p) => sum + (invoicedByProject[p.id]?.balance ?? 0),
    0
  );
  const activeCount = projects.filter((p) => p.status === "active").length;

  if (projects.length === 0)
    return (
      <div>
        <PageHeader title="Home" subtitle="No projects yet" flush />
        <EmptyState
          icon="home"
          title="No projects yet"
          description="Create your first renovation project to start tracking costs."
          action={
            <Link href="/projects/new" className="btn-primary">
              <Icon name="plus" size={18} strokeWidth={2.25} />
              Create project
            </Link>
          }
        />
        <Fab href="/projects/new" label="New project" />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Home"
        subtitle={`${projects.length} ${
          projects.length === 1 ? "project" : "projects"
        }${activeCount ? ` · ${activeCount} active` : ""}`}
        flush
        action={
          <Link
            href="/projects/new"
            className="btn-primary btn-sm hidden sm:inline-flex"
          >
            <Icon name="plus" size={16} strokeWidth={2.25} />
            New project
          </Link>
        }
      />

      <div className="space-y-5">
        <HeroStat
          label={
            view === "money"
              ? `Total ${MONEY.cost.label.toLowerCase()} across all projects`
              : "Across all projects"
          }
          value={
            view === "money"
              ? formatCurrency(totalCost)
              : rollup.behind > 0
                ? `${rollup.behind} behind`
                : "On schedule"
          }
          sub={
            view === "money" ? (
              totalOwed > 0.001 ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
                  {formatCurrency(totalOwed)} still{" "}
                  {MONEY.owed.label.toLowerCase()} on invoices
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
                  Every invoice settled
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    rollup.behind > 0 ? "bg-red-300" : "bg-emerald-300"
                  }`}
                />
                {rollup.worst_days !== null
                  ? `worst is ${rollup.worst_days} days late`
                  : "nothing measured against a baseline yet"}
                {rollup.order_soon > 0
                  ? ` · ${rollup.order_soon} to order soon`
                  : ""}
              </span>
            )
          }
        />

        {/* Two Track B warnings, above the segmented control so they show on
            both views.

            They are here rather than on a detail page because that is the
            whole point of each: a certificate expiry buried behind three taps
            is a date nobody reads, and a retention is deliberately kept out of
            Owed (0019) so nothing else in the app will ever chase it. Neither
            renders at all when there is nothing to say. */}
        {expiringCertifications.length > 0 ? (
          <Link
            href="/directory?view=people"
            className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20 transition active:bg-amber-100"
          >
            <Icon name="alert" size={19} className="shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-amber-900">
                {certificateSentence}
              </span>
              <span className="mt-0.5 block truncate text-xs text-amber-800/80">
                {expiringCertifications
                  .slice(0, 3)
                  .map((c) => `${c.contact_name} · ${c.kind}`)
                  .join(" · ")}
              </span>
            </span>
            <Icon
              name="chevronRight"
              size={18}
              className="shrink-0 text-amber-400"
            />
          </Link>
        ) : null}

        {retentionsDue.length > 0 ? (
          <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-inset ring-blue-600/15">
            <p className="flex items-center gap-2 text-sm font-bold text-blue-900">
              <Icon name="wallet" size={18} />
              {retentionsDue.length}{" "}
              {retentionsDue.length === 1 ? "retention is" : "retentions are"}{" "}
              due for release
            </p>
            <ul className="mt-1.5 space-y-1">
              {retentionsDue.slice(0, 4).map((row) => (
                <li key={row.purchase.id}>
                  <Link
                    href={`/projects/${row.purchase.project_id}/purchases/${row.purchase.id}/edit`}
                    className="flex items-baseline justify-between gap-3 text-[0.8125rem] text-blue-900 hover:underline"
                  >
                    <span className="min-w-0 truncate">
                      {row.supplier_name ?? "No supplier"}
                      {row.purchase.invoice_no
                        ? ` · ${row.purchase.invoice_no}`
                        : ""}
                      {row.project_name ? ` · ${row.project_name}` : ""}
                    </span>
                    <span className="tnum shrink-0 font-bold">
                      {formatCurrency(row.purchase.retention_held)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-blue-800/80">
              Held back and past the agreed release date. Retention is
              deliberately not counted as {MONEY.owed.label.toLowerCase()}, so
              nothing else will remind you.
            </p>
          </div>
        ) : null}

        <SegmentedControl
          fill
          label="Portfolio view"
          value={view}
          onChange={setView}
          options={[
            { value: "money", label: "Money" },
            { value: "schedule", label: "Schedule" },
          ]}
        />

        {view === "money" ? (
          <section>
            <SectionHeader
              title="Projects"
              hint={`${MONEY.cost.hint}, including invoices`}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  spent={spentByProject[p.id] ?? 0}
                  invoices={invoicedByProject[p.id]}
                  health={healthById.get(p.id)}
                />
              ))}
            </div>
          </section>
        ) : healths.length === 0 ? (
          <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
            <p className="text-sm font-bold text-amber-900">
              The schedule tables are not there yet
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
              Run <code>0016_schedule_core.sql</code>,{" "}
              <code>0017_task_cost_link.sql</code> and{" "}
              <code>0018_work_calendar.sql</code> in the Supabase SQL editor, in
              that order. Migrations here are applied by hand — writing the file
              does not run it.
            </p>
          </div>
        ) : (
          <PortfolioGantt healths={healths} bundles={bundles} />
        )}
      </div>

      <Fab href="/projects/new" label="New project" />
    </div>
  );
}

function ProjectCard({
  project,
  spent,
  invoices,
  health,
}: {
  project: Project;
  spent: number;
  invoices?: ProjectSpend;
  health?: ProjectHealth;
}) {
  const budget = Number(project.target_budget);
  const usedPct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const over = budget > 0 && spent > budget;
  const tone = scheduleTone(health?.days_variance ?? null);

  return (
    <Link
      href={`/projects/${project.id}`}
      className="card block transition active:scale-[0.99] hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-[0.9375rem] font-bold tracking-[-0.01em] text-gray-900">
          {project.name}
        </h3>
        <Badge label={project.status} />
      </div>

      {/* The cost is the reason the card exists, so it is the biggest thing on
          it. "Spent" was this card's own word for what every other screen now
          calls Cost — same figure, same word. */}
      <p className="tnum mt-3 text-2xl font-bold leading-none tracking-[-0.02em] text-gray-900">
        {formatCurrency(spent)}
      </p>
      <p className="mt-1 text-xs text-gray-500">{MONEY.cost.label} to date</p>

      {budget > 0 ? (
        <div className="mt-3.5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all ${
                over ? "bg-red-500" : usedPct > 85 ? "bg-amber-500" : "bg-brand"
              }`}
              style={{ width: `${Math.min(Math.max(usedPct, 2), 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className={over ? "font-semibold text-red-600" : "text-gray-500"}>
              {usedPct}% of {BUDGET.label.toLowerCase()}
            </span>
            <span className="tnum text-gray-400">{formatCurrency(budget)}</span>
          </div>
        </div>
      ) : null}

      {/* The schedule half. A SECOND bar, in a different colour, explicitly
          labelled "built" — never merged with the budget bar above it. The two
          measure different things and a job that is 40% built and 70% spent
          has to be able to say so. */}
      {health && health.task_count > 0 ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-violet-500 transition-all"
              style={{
                width: `${Math.min(Math.max(health.pct_complete, 2), 100)}%`,
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="text-gray-500">{health.pct_complete}% built</span>
            <span
              className={`font-semibold ${
                tone === "bad"
                  ? "text-red-600"
                  : tone === "warn"
                    ? "text-amber-600"
                    : tone === "good"
                      ? "text-emerald-600"
                      : "text-gray-400"
              }`}
            >
              {scheduleLabel(health)}
            </span>
          </div>
          {health.completion ? (
            <p className="mt-1 text-xs text-gray-400">
              finishes {fmtDate(health.completion)}
            </p>
          ) : null}
        </div>
      ) : null}

      {invoices && invoices.count > 0 ? (
        <div className="mt-3.5 border-t border-gray-200/70 pt-3">
          {/* Explicitly a subset of the Cost above, not a second pot — the card
              used to print "Invoiced" next to "Spent" with no hint that one
              contained the other. */}
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-gray-400">
            Of that, on {invoices.count}{" "}
            {invoices.count === 1 ? "invoice" : "invoices"}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <MiniFigure
              label={MONEY.paid.label}
              value={formatCurrency(invoices.paid)}
            />
            <MiniFigure
              label={MONEY.owed.label}
              value={formatCurrency(invoices.balance)}
              tone={invoices.balance > 0.001 ? "bad" : "good"}
            />
            <MiniFigure
              label={MONEY.cost.label}
              value={formatCurrency(invoices.gross)}
            />
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function MiniFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <span className="block truncate text-2xs font-medium text-gray-400">
        {label}
      </span>
      <span
        className={`tnum block truncate text-[0.8125rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-600"
              : "text-gray-900"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
