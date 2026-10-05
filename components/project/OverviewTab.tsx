"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";
import { MONEY, BUDGET } from "@/lib/vocabulary";
import { StatCard } from "@/components/ui/StatCard";
import { SectionHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { WeeklySpendChart } from "@/components/charts/WeeklySpendChart";
import { CategoryDonut } from "@/components/charts/CategoryDonut";
import { combineTotals } from "@/components/purchases/totals";
import {
  budgetWithApprovedVariations,
  variationSentence,
} from "@/lib/variations";
import type {
  ProjectCostRollup,
  ProjectSummary,
  WeekTotal,
  CategoryTotal,
  ItemPriceRow,
  PurchaseTotals,
  VariationRollup,
} from "@/types";

/**
 * The project's non-money screens, each a route of its own.
 *
 * They are routes rather than tabs for the reason stated in ProjectDetail:
 * five tabs is already one more than the 2026-08-28 collapse settled on, and
 * none of these is another way of looking at the spend — which is what earns a
 * tab. But a route still needs a visible door, and until now the only one was
 * the "⋯" menu.
 *
 * `camera` for documents rather than `receipt`: `receipt` means *invoice*
 * everywhere else in this app (the nav item, the Invoices tab, the AddMenu),
 * and this screen is mostly site photos.
 *
 * The hints are shorter than the ones in the "⋯" sheet were, because these sit
 * two to a row on a phone rather than full width.
 */
const PROJECT_LINKS: {
  slug: string;
  label: string;
  hint: string;
  icon: IconName;
  tone: "brand" | "info" | "warn" | "neutral";
}[] = [
  {
    slug: "log",
    label: "Log & snags",
    hint: "Calls, visits, and what needs putting right",
    icon: "list",
    tone: "brand",
  },
  {
    slug: "documents",
    label: "Documents & photos",
    hint: "Planning, certificates, drawings, site photos",
    icon: "camera",
    tone: "info",
  },
  {
    slug: "orders",
    label: "Orders",
    hint: "What you ordered, and what was billed for it",
    icon: "truck",
    tone: "warn",
  },
  {
    slug: "variations",
    label: "Variations",
    hint: "What changed, why, and what it cost",
    icon: "edit",
    tone: "neutral",
  },
];

export default function OverviewTab({
  projectId,
  summary,
  byWeek,
  byCategory,
  priceAlerts,
  onViewPrices,
  invoiceTotals,
  onViewInvoices,
  costRollup,
  onViewTasks,
  retentionHeld = 0,
  retentionDueCount = 0,
  onViewInvoicesForRetention,
  variationRollup = null,
  onViewVariations,
  onWeekSaved,
}: {
  /** For the "More on this project" tiles, which are plain links. */
  projectId: string;
  summary: ProjectSummary;
  byWeek: WeekTotal[];
  byCategory: CategoryTotal[];
  // Items whose latest invoice priced them higher per unit than the buy before,
  // comparing like with like — an item bought in a different unit this time is
  // not in here, because no honest percentage exists for it.
  priceAlerts: ItemPriceRow[];
  onViewPrices: () => void;
  // What part of the Cost card came in on invoices. This is a SUBSET of the
  // cards below, not a separate pot — see the note rendered under the cards.
  invoiceTotals: PurchaseTotals[];
  // The invoice list is a tab now, not a route, so this switches tab rather
  // than navigating away from the project screen.
  onViewInvoices: () => void;
  // Budget vs cost across the project's tasks, plus the untagged total.
  // Null until migration 0016 has been run and some tasks exist.
  costRollup?: ProjectCostRollup | null;
  onViewTasks?: () => void;
  /**
   * Σ retention still held on this project's invoices (migration 0019).
   *
   * Reported BESIDE Owed and subtracted from it, never folded in. A retention
   * is money you agreed to hold back, not a bill you are late paying, and
   * telling the two apart is the entire feature.
   */
  retentionHeld?: number;
  /** How many of those are past their agreed release date. */
  retentionDueCount?: number;
  onViewInvoicesForRetention?: () => void;
  /**
   * The project's variation position (migration 0024) — approved and proposed
   * cost and days, counted separately and never added.
   *
   * It is here because it was NOWHERE. `variationRollup` was computed and only
   * the variations route rendered it, so a £12,000 approved change left the
   * project reading as £12,000 over budget with nothing on any screen saying
   * why. Null when 0024 has not been run, which means "say nothing" rather
   * than "there are none".
   */
  variationRollup?: VariationRollup | null;
  onViewVariations?: () => void;
  /**
   * Called after a week's "% built" has been saved, so the page can refetch.
   * The figure comes from `project_weeks`, which only the server reads, so
   * without this the cell would show the new number and every other screen
   * would keep the old one until a reload.
   */
  onWeekSaved?: () => void;
}) {
  const invoiced = combineTotals(invoiceTotals);
  /**
   * Budget with the variations that were actually AGREED in it.
   *
   * Derived, never stored: `projects.target_budget` stays exactly as it was
   * typed, because a target that moves on its own is not a target. Only
   * approved variations count — a proposed one is a conversation — and the
   * figure is signed, so an omission subtracts.
   *
   * The two halves are on different VAT bases and both cards say so. A
   * variation is agreed ex VAT to match the task budgets it is compared
   * against (rule 7); the money cards above are incl VAT. Grossing the
   * variation up at an invented rate would be a guess dressed as arithmetic,
   * so the agreed figure is added as agreed and the basis is printed.
   */
  const approvedVariations = variationRollup?.approved_cost ?? 0;
  const adjustedBudget = budgetWithApprovedVariations(
    summary.target_budget,
    variationRollup
  );
  const variationLine = variationRollup
    ? variationSentence(variationRollup, formatCurrency)
    : null;
  // `summary.remaining_to_pay` is built from the cost totals and knows nothing
  // about retention, so it is corrected here rather than in buildSummary —
  // which also serves hand-entered diary rows, where retention does not exist.
  const owed = Math.max(0, summary.remaining_to_pay - retentionHeld);

  /**
   * Is there a Committed figure at all, and does it cover the whole job?
   *
   * `total_quoted` is Σ of the agreed figures, and the agreed figure is NULL on
   * nearly every row (committedGross in lib/purchases.ts). Zero therefore means
   * "nobody recorded one", not "it was agreed at nothing", and the cards it
   * feeds are hidden rather than shown as £0.00 — the same choice the Analysis
   * tab makes when it renders its Committed column as "—".
   *
   * Coverage is the second half of it: a variance only answers "is this job on
   * quote" when all of the cost has a quote behind it.
   */
  const committedKnown = summary.total_quoted > 0.005;
  const committedPct = Math.round(summary.quoted_coverage * 100);
  const partlyCommitted = committedKnown && summary.quoted_coverage < 0.995;

  return (
    <div className="space-y-6">
      {/* Price rises, surfaced without opening Analysis. First on the tab
          because it is the only thing here that asks the reader to do
          something; everything below it is reference. */}
      {priceAlerts.length > 0 ? (
        <section className="overflow-hidden rounded-2xl bg-amber-50 ring-1 ring-inset ring-amber-600/15">
          <div className="flex items-start gap-3 px-4 pt-3.5">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <Icon name="arrowUp" size={17} strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[0.9375rem] font-bold text-amber-900">
                {priceAlerts.length} {priceAlerts.length === 1 ? "item" : "items"}{" "}
                cost more than last time
              </h3>
              <p className="mt-0.5 text-xs text-amber-800/80">
                Compared with the previous invoice, like for like.
              </p>
            </div>
          </div>

          <ul className="mt-3 divide-y divide-amber-600/10 border-t border-amber-600/10">
            {priceAlerts.slice(0, 5).map((p) => {
              const unit = p.units[p.units.length - 1];
              return (
                <li
                  key={p.item_id ?? p.item}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-amber-900">
                    {p.item}
                  </span>
                  <span className="tnum shrink-0 text-sm font-semibold text-amber-900">
                    {formatCurrency(p.latest_price)}
                    {unit ? `/${unit}` : ""}
                  </span>
                  <span className="tnum shrink-0 rounded-full bg-amber-200/70 px-2 py-0.5 text-2xs font-bold text-amber-900">
                    +{(p.latest_delta_pct ?? 0).toFixed(1)}%
                  </span>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={onViewPrices}
            className="flex min-h-touch w-full items-center justify-center gap-1.5 border-t border-amber-600/10 px-4 text-sm font-semibold text-amber-900 transition active:bg-amber-100"
          >
            {priceAlerts.length > 5
              ? `See all ${priceAlerts.length} in price history`
              : "See price history"}
            <Icon name="chevronRight" size={16} strokeWidth={2.25} />
          </button>
        </section>
      ) : null}

      {/* The project's money, in the four words used on every other screen —
          see lib/vocabulary.ts. Each card carries the one-line definition, so
          nobody has to guess whether "Cost" includes VAT or whether it counts
          invoices. */}
      <section>
        <SectionHeader title="The money" hint="All figures include VAT" />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {summary.target_budget > 0 ? (
            <StatCard
              icon="wallet"
              label={BUDGET.label}
              value={formatCurrency(summary.target_budget)}
              hint={BUDGET.hint}
            />
          ) : null}
          {/* The budget as it stands after the changes that were agreed. It is
              a SECOND card rather than a replacement for the one above: what
              was originally agreed and what it has become are two different
              questions, and a screen that only answers the second loses the
              ability to ask how far the job has moved from its original
              target. Only shown when an approved variation has actually moved
              it. */}
          {summary.target_budget > 0 && Math.abs(approvedVariations) > 0.001 ? (
            <StatCard
              icon="hammer"
              label="Budget + variations"
              value={formatCurrency(adjustedBudget)}
              hint={`Incl. ${approvedVariations > 0 ? "+" : ""}${formatCurrency(
                approvedVariations
              )} approved, agreed ex VAT`}
            />
          ) : null}
          {/* Only when something actually was agreed in advance. This card and
              the Variance card below used to render unconditionally, and
              because `quoted_gross` had no write path the figure behind them
              fell back to the invoice's own total — so Committed equalled Cost
              to the penny, Variance was structurally £0.00, and its hint read
              "Within Committed" on every project for ever. A card that cannot
              be wrong cannot be right either; absent is the honest state, and
              it is what the Analysis tab has always shown. */}
          {committedKnown ? (
            <StatCard
              icon="check"
              label={MONEY.committed.label}
              value={formatCurrency(summary.total_quoted)}
              hint={
                partlyCommitted
                  ? `${MONEY.committed.hint} — ${committedPct}% of cost`
                  : MONEY.committed.hint
              }
            />
          ) : null}
          <StatCard
            icon="chart"
            label={MONEY.cost.label}
            value={formatCurrency(summary.forecast_total)}
            hint={MONEY.cost.hint}
            tone="brand"
          />
          {/* Stricter than the card above: a variance is only a budget check
              when every pound of cost has an agreed figure behind it. At 40%
              coverage it subtracts two quoted jobs from the cost of five and
              calls the other three an overrun. */}
          {committedKnown && !partlyCommitted ? (
            <StatCard
              icon={summary.variance > 0 ? "arrowUp" : "arrowDown"}
              label="Variance"
              value={formatCurrency(summary.variance)}
              tone={summary.variance > 0 ? "bad" : "good"}
              hint={
                summary.variance > 0
                  ? `Over ${MONEY.committed.label.toLowerCase()}`
                  : `Within ${MONEY.committed.label.toLowerCase()}`
              }
            />
          ) : null}
          <StatCard
            icon="wallet"
            label={MONEY.paid.label}
            value={formatCurrency(summary.paid_to_date)}
            hint={MONEY.paid.hint}
          />
          {/* Owed, with retention taken out of it (migration 0019). With no
              retention anywhere — every project before 0019 was run — `owed`
              below is `summary.remaining_to_pay` unchanged, to the penny. */}
          <StatCard
            icon="clock"
            label={MONEY.owed.label}
            value={formatCurrency(owed)}
            tone={owed > 0.001 ? "bad" : "good"}
            hint={
              retentionHeld > 0.001
                ? `${MONEY.owed.hint}, retention excluded`
                : MONEY.owed.hint
            }
          />
          {retentionHeld > 0.001 ? (
            <StatCard
              icon="wallet"
              label="Retention held"
              value={formatCurrency(retentionHeld)}
              hint="Held back, not overdue"
            />
          ) : null}
          <StatCard
            icon="calendar"
            label="Weeks tracked"
            value={String(summary.weeks_tracked)}
          />
        </div>

        {/* Retention past its release date, in the same one-sentence shape as
            the invoice and task sentences above. It needs saying somewhere,
            because retention is deliberately kept out of Owed — so nothing
            else on any screen will ever chase it. */}
        {retentionDueCount > 0 ? (
          <button
            type="button"
            onClick={onViewInvoicesForRetention}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-inset ring-amber-600/20 transition active:bg-amber-100"
          >
            <Icon name="clock" size={18} className="shrink-0 text-amber-600" />
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-amber-900">
              <span className="font-bold">
                {retentionDueCount}{" "}
                {retentionDueCount === 1 ? "retention is" : "retentions are"}
              </span>{" "}
              past the agreed release date. Nothing else will chase them — they
              are deliberately not counted as {MONEY.owed.label.toLowerCase()}.
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-amber-400" />
          </button>
        ) : null}

        {/* Where the Cost figure came from.
            This replaces the "Invoice Summary" banner that used to sit above all
            seven tabs. That banner repeated Invoiced / Paid / Outstanding in its
            own words directly above these cards, and because invoice rows are
            already counted in Cost above (they arrive with source: "invoice", so
            the diary filter keeps them), it was showing a SUBSET of the number
            beside it as though it were a separate total. Anyone comparing the two
            concluded the app disagreed with itself.
            One sentence, on the one tab that is about totals, saying plainly that
            it is a part of the figure above. */}
        {invoiced && invoiced.purchase_count > 0 ? (
          <button
            type="button"
            onClick={onViewInvoices}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 text-left transition active:bg-gray-200"
          >
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-gray-600">
              <span className="tnum font-bold text-gray-900">
                {formatCurrency(invoiced.gross)}
              </span>{" "}
              of that {MONEY.cost.label.toLowerCase()} came in on{" "}
              {invoiced.purchase_count}{" "}
              {invoiced.purchase_count === 1 ? "invoice" : "invoices"}
              {invoiced.balance > 0.001 ? (
                <>
                  , of which{" "}
                  <span className="tnum font-bold text-red-600">
                    {formatCurrency(invoiced.balance)}
                  </span>{" "}
                  is still {MONEY.owed.label.toLowerCase()}.
                </>
              ) : (
                ", all paid."
              )}
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-gray-400" />
          </button>
        ) : null}

        {/* The schedule half of the same question, in the same shape: one
            sentence saying how much of the Cost above is accounted for by a
            piece of work, and how much is not.

            The untagged half is the point. Without it a project reads as
            perfectly on budget while half its spend sits against no task at
            all — which is exactly how per-task reporting produces a
            comforting, wrong answer. Ex VAT throughout, because a task budget
            is ex VAT and the two have to be comparable. */}
        {costRollup && (costRollup.budget > 0 || costRollup.tagged_line_count > 0) ? (
          <button
            type="button"
            onClick={onViewTasks}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 text-left transition active:bg-gray-200"
          >
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-gray-600">
              <span className="tnum font-bold text-gray-900">
                {formatCurrency(costRollup.net)}
              </span>{" "}
              of{" "}
              <span className="tnum font-bold text-gray-900">
                {formatCurrency(costRollup.budget)}
              </span>{" "}
              task {BUDGET.label.toLowerCase()} spent, ex VAT
              {costRollup.untagged_line_count > 0 ? (
                <>
                  {" "}&mdash;{" "}
                  <span className="tnum font-bold text-amber-700">
                    {formatCurrency(costRollup.untagged_net)}
                  </span>{" "}
                  on {costRollup.untagged_line_count}{" "}
                  {costRollup.untagged_line_count === 1 ? "line" : "lines"} is
                  tagged to no task.
                </>
              ) : (
                ". Every line is tagged to a task."
              )}
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-gray-400" />
          </button>
        ) : null}

        {/* What was agreed as a CHANGE, in the same one-sentence shape as the
            invoice and task lines above.

            Approved and proposed are said apart and never added — an approved
            variation is a commitment, a proposed one is a conversation, and a
            budget that quietly includes conversations is a forecast that is
            fiction. The basis is printed because it differs from the cards
            above it: a variation is agreed EX VAT, to match the task budgets
            it is compared against, while the money cards are incl VAT. */}
        {variationLine ? (
          <button
            type="button"
            onClick={onViewVariations}
            className="mt-2.5 flex w-full items-center gap-3 rounded-2xl bg-gray-100 px-4 py-3 text-left transition active:bg-gray-200"
          >
            <span className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-gray-600">
              {variationLine}
              {Math.abs(approvedVariations) > 0.001 ? (
                <>
                  {" "}
                  Approved variations are added to the budget above as agreed;
                  proposed ones are not, and nothing is regrossed for VAT.
                </>
              ) : (
                <>
                  {" "}
                  Nothing is approved yet, so the budget above is unchanged.
                </>
              )}
            </span>
            <Icon name="chevronRight" size={18} className="shrink-0 text-gray-400" />
          </button>
        ) : null}
      </section>

      {/* The four screens that are not about money.

          They were reachable from exactly one place in the whole app — the
          unlabelled "⋯" in the project header, which also holds Edit, Export
          and Delete and therefore reads as a settings menu rather than as a
          list of places. Documents and Orders had ONE inbound link each; there
          was no way to raise a first snag without finding that menu. Four built
          modules were effectively invisible.

          So they are named, here, in the body of the tab every project opens
          on. Deliberately no counts on these tiles: the open-snag count is
          already a banner above the tab strip and the variation position is
          already a sentence a few inches above this row, so a badge would
          repeat them — and a tile with no badge would then read as "none",
          which for Documents and Orders would be a guess (neither count is
          loaded on this page). These are doors, not figures. */}
      <section>
        <SectionHeader
          title="More on this project"
          hint="The record that is not money"
        />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {PROJECT_LINKS.map((link) => (
            <Link
              key={link.slug}
              href={`/projects/${projectId}/${link.slug}`}
              className="card flex flex-col gap-2 transition active:scale-[0.99] hover:border-brand-200 hover:shadow-soft"
            >
              <IconTile name={link.icon} tone={link.tone} size="lg" />
              <span className="text-[0.9375rem] font-bold leading-tight tracking-[-0.01em] text-gray-900">
                {link.label}
              </span>
              <span className="text-xs leading-snug text-gray-500">
                {link.hint}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title="Where the money went" />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 text-[0.8125rem] font-semibold text-gray-600">
              Weekly spend
            </h3>
            <WeeklySpendChart data={byWeek} />
          </div>
          <div className="card">
            <h3 className="mb-3 text-[0.8125rem] font-semibold text-gray-600">
              Labour vs materials
            </h3>
            <CategoryDonut data={byCategory} />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          title="Week by week"
          hint={byWeek.length ? `${byWeek.length} weeks logged` : undefined}
        />
        {byWeek.length === 0 ? (
          <div className="card py-10 text-center">
            <p className="text-sm text-gray-500">No costs logged yet.</p>
          </div>
        ) : (
          <>
            {/* Mobile: one row per week, with the split underneath. A five
                column table on a 375px screen is unreadable at any font size. */}
            <ul className="card-flush row-divide sm:hidden">
              {byWeek.map((w) => (
                <li key={w.week_number} className="px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.9375rem] font-bold text-gray-900">
                      Week {w.week_number}
                    </span>
                    <span className="tnum text-[0.9375rem] font-bold text-gray-900">
                      {formatCurrency(w.total)}
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2">
                    <WeekSplit label="Labour" value={w.labour} />
                    <WeekSplit label="Materials" value={w.materials} />
                    <WeekSplit label="VAT" value={w.vat} />
                  </dl>
                  {/* The same editor as the desktop column. This list is the
                      ONLY week-by-week table on a phone — the desktop table is
                      `hidden`, so a column added there alone is invisible on
                      the device most of this gets typed on. */}
                  <div className="mt-2.5 flex items-center justify-between gap-3">
                    <span className="text-2xs font-medium uppercase tracking-wider text-gray-500">
                      % built
                    </span>
                    <WeekCompletion
                      projectId={projectId}
                      weekNumber={w.week_number}
                      value={w.completion_pct}
                      onSaved={onWeekSaved}
                    />
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table. */}
            <div className="card hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
                    <th className="pb-2.5">Week</th>
                    <th className="pb-2.5 text-right">Labour</th>
                    <th className="pb-2.5 text-right">Materials</th>
                    <th className="pb-2.5 text-right">VAT</th>
                    <th className="pb-2.5 text-right">Total</th>
                    <th className="pb-2.5 text-right">% built</th>
                  </tr>
                </thead>
                <tbody className="tnum divide-y divide-gray-200/70">
                  {byWeek.map((w) => (
                    <tr key={w.week_number}>
                      <td className="py-2.5 font-semibold text-gray-900">
                        W{w.week_number}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.labour)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.materials)}
                      </td>
                      <td className="py-2.5 text-right text-gray-600">
                        {formatCurrency(w.vat)}
                      </td>
                      <td className="py-2.5 text-right font-bold text-gray-900">
                        {formatCurrency(w.total)}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex justify-end">
                          <WeekCompletion
                            projectId={projectId}
                            weekNumber={w.week_number}
                            value={w.completion_pct}
                            onSaved={onWeekSaved}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * A week's manual "% built", editable in place.
 *
 * `project_weeks.completion_pct` has existed since migration 0001 and
 * `PATCH /api/projects/[id]/weeks` has been able to write it for just as long,
 * but nothing on any screen rendered it and nothing called the route, so it sat
 * at 0 for every week of the job. It is worth having beside the Schedule's own
 * `pct_complete`: that one is per task, this one is "how much of this week's
 * work actually got done", which is the judgement you make on site on a Friday.
 *
 * Saved on blur or Enter, not on every keystroke — the field is a free-text
 * number and an intermediate "1" on the way to "100" is not a value to store.
 * Escape abandons the edit. The number shown is optimistic; `onSaved` asks the
 * page to refetch so the server's copy wins a moment later.
 */
function WeekCompletion({
  projectId,
  weekNumber,
  value,
  onSaved,
}: {
  projectId: string;
  weekNumber: number;
  value: number;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState(() => String(Math.round(value)));
  const [saving, setSaving] = useState(false);

  // The prop is the truth once a refetch lands. Without this the cell would
  // keep whatever was last typed even after the server rejected or changed it.
  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  async function commit() {
    const next = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(next)) {
      setDraft(String(Math.round(value)));
      return;
    }
    const pct = Math.round(next);
    if (pct < 0 || pct > 100) {
      toast("% built must be 0–100", "error");
      setDraft(String(Math.round(value)));
      return;
    }
    if (pct === Math.round(value)) {
      setDraft(String(pct));
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/weeks`, {
        method: "PATCH",
        body: JSON.stringify({ week_number: weekNumber, completion_pct: pct }),
      });
      setDraft(String(pct));
      onSaved?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save % built", "error");
      setDraft(String(Math.round(value)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <label className="sr-only" htmlFor={`week-pct-${weekNumber}`}>
        Week {weekNumber} per cent built
      </label>
      <input
        id={`week-pct-${weekNumber}`}
        className="input tnum h-9 min-h-0 w-16 px-2 py-0 text-right"
        inputMode="numeric"
        disabled={saving}
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(String(Math.round(value)));
            e.currentTarget.blur();
          }
        }}
      />
      <span className="text-[0.8125rem] font-medium text-gray-500">%</span>
    </span>
  );
}

function WeekSplit({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-gray-100 px-2.5 py-2">
      <dt className="text-2xs font-medium text-gray-500">{label}</dt>
      <dd className="tnum mt-0.5 text-[0.8125rem] font-semibold text-gray-900">
        {formatCurrency(value)}
      </dd>
    </div>
  );
}
