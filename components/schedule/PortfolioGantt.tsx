"use client";

import { useMemo } from "react";
import Link from "next/link";
import { formatCurrency } from "@/lib/calculations";
import { scheduleLabel, scheduleTone } from "@/lib/portfolio";
import { scheduleProject } from "@/lib/schedule";
import { fmtDate } from "@/components/project/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import Gantt from "./Gantt";
import type { ProjectHealth, ScheduleBundle } from "@/types";

/**
 * Every live site on one screen: how far through, how far behind, how far over.
 *
 * The spec's §6 dashboard and §7's "multi-project / portfolio Gantt", which are
 * the same question asked twice — once as figures and once as bars — so they
 * are one screen with both.
 *
 * **Two percentages, both named, always.** `pct_complete` is the
 * duration-weighted mean of hand-entered task progress; the cost figure beside
 * it is spend against budget. A job is routinely 40% built and 70% spent, and
 * that gap is the most useful thing this screen says. Showing one number that
 * silently means the other is the classic renovation reporting error, and it
 * is the error this layout exists to avoid.
 *
 * The rolled-up chart is one `Gantt` per project rather than one chart with
 * every bar in it. Two sites' tasks share no dependencies and no critical path,
 * so a single grid would draw arrows that cross between jobs and a "critical
 * path" that spans two unrelated buildings. Stacked charts are honest about
 * that; a merged one is not.
 */
export default function PortfolioGantt({
  healths,
  bundles,
}: {
  healths: ProjectHealth[];
  bundles: ScheduleBundle[];
}) {
  const schedules = useMemo(
    () => new Map(bundles.map((b) => [b.project.id, scheduleProject(b)])),
    [bundles]
  );
  const bundleById = useMemo(
    () => new Map(bundles.map((b) => [b.project.id, b])),
    [bundles]
  );

  // A project with no tasks has no schedule to roll up. It is not hidden —
  // "this site has no plan at all" is itself worth knowing — but it gets a line
  // rather than an empty chart.
  const withSchedule = healths.filter((h) => h.task_count > 0);
  const withoutSchedule = healths.filter((h) => h.task_count === 0);

  if (healths.length === 0)
    return (
      <EmptyState
        icon="home"
        title="No projects yet"
        description="Create a project and break it into tasks to see it here."
      />
    );

  return (
    <div className="space-y-5">
      {withSchedule.map((health) => {
        const bundle = bundleById.get(health.project_id);
        const schedule = schedules.get(health.project_id);
        if (!bundle || !schedule) return null;
        return (
          <section key={health.project_id}>
            <HealthHeader health={health} />
            <Gantt
              schedule={schedule}
              phases={bundle.phases}
              dependencies={bundle.dependencies}
              baseline={bundle.baseline}
              calendar={bundle.calendar}
              selectedId={null}
              // Read-only here on purpose. Editing one site's schedule from a
              // screen about all of them is how you move the wrong bar; the
              // header links straight through to the project that owns it.
              onSelect={() => {}}
              onShift={() => {}}
            />
          </section>
        );
      })}

      {withoutSchedule.length > 0 ? (
        <section>
          <p className="eyebrow mb-2">No schedule yet</p>
          <ul className="card-flush row-divide">
            {withoutSchedule.map((health) => (
              <li key={health.project_id}>
                <Link
                  href={`/projects/${health.project_id}?tab=schedule`}
                  className="row"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold text-gray-900">
                      {health.project_name}
                    </span>
                    <span className="mt-0.5 block text-[0.8125rem] text-gray-500">
                      {formatCurrency(health.cost)} spent, no tasks to measure it
                      against
                    </span>
                  </span>
                  <Icon
                    name="chevronRight"
                    size={18}
                    className="shrink-0 text-gray-300"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function HealthHeader({ health }: { health: ProjectHealth }) {
  const tone = scheduleTone(health.days_variance);
  const overBudget = health.budget > 0 && health.budget_variance > 0;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Link
        href={`/projects/${health.project_id}?tab=schedule`}
        className="text-base font-bold tracking-[-0.01em] text-gray-900 hover:text-brand-700"
      >
        {health.project_name}
      </Link>

      <Badge
        label={scheduleLabel(health)}
        tone={tone === "neutral" ? "neutral" : tone}
      />

      {/* Both percentages, side by side and labelled. Never one. */}
      <span className="tnum text-xs font-medium text-gray-500">
        {health.pct_complete}% built
        {health.pct_cost !== null ? ` · ${health.pct_cost}% spent` : ""}
      </span>

      {overBudget ? (
        <span className="tnum text-xs font-bold text-red-600">
          +{formatCurrency(health.budget_variance)} over
        </span>
      ) : null}

      {health.completion ? (
        <span className="ml-auto text-xs text-gray-400">
          finishes {fmtDate(health.completion)}
        </span>
      ) : null}
    </div>
  );
}
