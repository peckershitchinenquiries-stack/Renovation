"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { variationsOverAgreement } from "@/lib/variations";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { ChipRow } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import VariationForm from "@/components/forms/VariationForm";
import type { VariationList } from "@/lib/data";
import {
  VARIATION_STATUS_LABELS,
  type Project,
  type VariationStatus,
  type VariationView,
} from "@/types";

const STATUS_TONE: Record<
  VariationStatus,
  "good" | "warn" | "bad" | "neutral"
> = {
  approved: "good",
  proposed: "warn",
  rejected: "bad",
  withdrawn: "neutral",
};

/**
 * Change orders (migration 0024).
 *
 * The two headline figures are deliberately separate and never added:
 * **approved** is a commitment, **proposed** is a conversation. A forecast that
 * quietly includes conversations is fiction.
 *
 * Each row shows what was AGREED next to what the linked task has ACTUALLY
 * cost. That comparison is the only reason anybody opens a variations log six
 * months later, and collapsing the two into one figure throws it away.
 */
export default function VariationsScreen({
  list,
  project,
}: {
  // Null means migration 0024 has not been run.
  list: VariationList | null;
  project: Project;
}) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<VariationView | null>(null);
  const [deleting, setDeleting] = useState<VariationView | null>(null);

  const variations = useMemo(() => list?.variations ?? [], [list]);
  const rollup = list?.rollup;
  const overrun = useMemo(
    () => variationsOverAgreement(variations),
    [variations]
  );

  const visible = useMemo(
    () =>
      filter === "all"
        ? variations
        : variations.filter((v) => v.status === filter),
    [variations, filter]
  );

  async function remove(v: VariationView) {
    try {
      await apiFetch(`/api/projects/${project.id}/variations/${v.id}`, {
        method: "DELETE",
      });
      toast("Variation deleted", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "error");
    } finally {
      setDeleting(null);
    }
  }

  if (!list)
    return (
      <div>
        <PageHeader
          title="Variations"
          subtitle={project.name}
          backHref={`/projects/${project.id}`}
          backLabel="Back to project"
        />
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="text-sm font-bold text-amber-900">
            The variations table is not there yet
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
            Run <code>0024_variations.sql</code> in the Supabase SQL editor.
            Migrations in this project are applied by hand — writing the file
            does not run it.
          </p>
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Variations"
        subtitle={`${variations.length} recorded · ${project.name}`}
        backHref={`/projects/${project.id}`}
        backLabel="Back to project"
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={16} />
            Raise
          </button>
        }
      />

      <div className="space-y-4">
        {rollup && variations.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <StatCard
              icon="check"
              tone={rollup.approved_cost > 0 ? "bad" : "good"}
              label="Approved, ex VAT"
              value={`${rollup.approved_cost > 0 ? "+" : ""}${formatCurrency(
                rollup.approved_cost
              )}`}
              hint={`${rollup.approved_count} committed`}
            />
            <StatCard
              icon="clock"
              label="Approved days"
              value={`${rollup.approved_days > 0 ? "+" : ""}${rollup.approved_days}`}
              tone={rollup.approved_days > 0 ? "bad" : "neutral"}
            />
            <StatCard
              icon="alert"
              label="Proposed, ex VAT"
              value={`${rollup.proposed_cost > 0 ? "+" : ""}${formatCurrency(
                rollup.proposed_cost
              )}`}
              hint={`${rollup.proposed_count} not committed`}
            />
            <StatCard
              icon="clock"
              label="Proposed days"
              value={`${rollup.proposed_days > 0 ? "+" : ""}${rollup.proposed_days}`}
            />
          </div>
        ) : null}
        {rollup && rollup.proposed_count > 0 ? (
          <p className="hint -mt-2">
            Approved and proposed are shown apart and never added. An approved
            variation is a commitment; a proposed one is a conversation.
          </p>
        ) : null}

        {overrun.length > 0 ? (
          <div className="rounded-2xl bg-amber-50 p-4 text-[0.8125rem] leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-600/20">
            <p className="flex items-center gap-2 font-bold">
              <Icon name="alert" size={17} />
              {overrun.length}{" "}
              {overrun.length === 1 ? "variation has" : "variations have"} cost
              more than was agreed
            </p>
            <p className="mt-1">
              A prompt to look, not a verdict: the task&apos;s cost includes
              everything tagged to it, not only this variation&apos;s share, so
              a task that was always going to cost something will exceed a small
              variation on its own.
            </p>
          </div>
        ) : null}

        {variations.length > 0 ? (
          <ChipRow
            label="Filter variations"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All", count: variations.length },
              {
                value: "proposed",
                label: "Proposed",
                count: rollup?.proposed_count ?? 0,
              },
              {
                value: "approved",
                label: "Approved",
                count: rollup?.approved_count ?? 0,
              },
              {
                value: "rejected",
                label: "Rejected",
                count: variations.filter((v) => v.status === "rejected").length,
              },
              {
                value: "withdrawn",
                label: "Withdrawn",
                count: variations.filter((v) => v.status === "withdrawn").length,
              },
            ]}
          />
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon="edit"
            title={
              variations.length === 0 ? "Nothing changed yet" : "Nothing to show"
            }
            description={
              variations.length === 0
                ? "Every renovation changes. Recording what changed, why, what it was worth and how many days it added is what makes the final figure defensible."
                : "No variations match this filter."
            }
            action={
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="btn btn-primary"
              >
                <Icon name="plus" size={16} />
                Raise a variation
              </button>
            }
          />
        ) : (
          <div className="space-y-2.5">
            {visible.map((v) => (
              <div key={v.id} className="card p-0">
                <button
                  type="button"
                  onClick={() => setEditing(v)}
                  className="flex w-full items-start gap-3 px-4 pb-3 pt-3.5 text-left"
                >
                  <IconTile name="edit" tone={STATUS_TONE[v.status]} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                      {v.ref ? (
                        <span className="text-gray-500">{v.ref} · </span>
                      ) : null}
                      {v.title}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {[
                        v.requested_by,
                        `raised ${formatDisplayDate(v.raised_on)}`,
                        v.task_name,
                        v.phase_name,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Badge
                    label={VARIATION_STATUS_LABELS[v.status]}
                    tone={STATUS_TONE[v.status]}
                  />
                </button>

                {v.description ? (
                  <p className="border-t border-gray-200/70 px-4 py-2.5 text-[0.8125rem] leading-relaxed text-gray-600">
                    {v.description}
                  </p>
                ) : null}

                {/* Agreed and actual, side by side. Never one number: what was
                    agreed and what happened are the two halves of the only
                    question this log answers. */}
                <div className="grid grid-cols-4 border-t border-gray-200/70">
                  <Cell
                    label="Agreed, ex VAT"
                    value={
                      v.cost_impact === null
                        ? "—"
                        : `${Number(v.cost_impact) > 0 ? "+" : ""}${formatCurrency(
                            Number(v.cost_impact)
                          )}`
                    }
                  />
                  <Cell
                    label="Task cost"
                    divider
                    value={
                      v.task_actual_net === null
                        ? "no task"
                        : formatCurrency(v.task_actual_net)
                    }
                    tone={
                      v.cost_impact !== null &&
                      v.task_actual_net !== null &&
                      v.task_actual_net > Number(v.cost_impact) + 0.01
                        ? "bad"
                        : "neutral"
                    }
                  />
                  <Cell
                    label="Agreed days"
                    divider
                    value={
                      v.days_impact === null
                        ? "—"
                        : `${Number(v.days_impact) > 0 ? "+" : ""}${v.days_impact}`
                    }
                  />
                  <Cell
                    label="Task drift"
                    divider
                    value={
                      v.task_drift_days === null
                        ? "—"
                        : `${v.task_drift_days > 0 ? "+" : ""}${v.task_drift_days}d`
                    }
                    tone={
                      v.task_drift_days !== null && v.task_drift_days > 0
                        ? "bad"
                        : "neutral"
                    }
                  />
                </div>

                <div className="flex items-center gap-1 border-t border-gray-200/70 px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setEditing(v)}
                    className="btn btn-ghost btn-sm"
                  >
                    <Icon name="edit" size={15} />
                    Edit
                  </button>
                  <span className="flex-1" />
                  <button
                    type="button"
                    aria-label="Delete variation"
                    onClick={() => setDeleting(v)}
                    className="btn-icon text-gray-300 hover:text-red-600"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        title={editing ? "Edit variation" : "Raise a variation"}
        size="lg"
      >
        <VariationForm
          projectId={project.id}
          variation={editing ?? undefined}
          phases={list.phases}
          tasks={list.tasks}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            router.refresh();
          }}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this variation?"
        message={`"${deleting?.title ?? ""}" will be removed entirely. If it was asked for and then dropped, set it to Withdrawn instead — the question will be asked again.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function Cell({
  label,
  value,
  divider = false,
  tone = "neutral",
}: {
  label: string;
  value: string;
  divider?: boolean;
  tone?: "neutral" | "bad";
}) {
  return (
    <div className={`px-3 py-2.5 ${divider ? "border-l border-gray-200/70" : ""}`}>
      <p className="text-2xs font-medium text-gray-400">{label}</p>
      <p
        className={`tnum mt-0.5 truncate text-[0.8125rem] font-bold ${
          tone === "bad" ? "text-red-600" : "text-gray-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
