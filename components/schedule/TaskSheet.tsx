"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { MONEY, BUDGET } from "@/lib/vocabulary";
import { fmtDate } from "@/components/project/format";
import { Sheet } from "@/components/ui/Sheet";
import { Badge } from "@/components/ui/Badge";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import TaskForm from "@/components/forms/TaskForm";
import DependencyEditor from "./DependencyEditor";
import TaskHistory from "./TaskHistory";
import { VarianceChip } from "./VarianceChip";
import {
  SIGNOFF_OUTCOMES,
  SIGNOFF_OUTCOME_LABELS,
  type SignoffOutcome,
} from "@/types";
import type {
  Contact,
  ProjectPhase,
  ScheduledTask,
  Task,
  TaskCostRow,
  TaskDependency,
  TaskRevision,
  TradeLookup,
  WorkCalendar,
} from "@/types";

type Pane = "detail" | "edit" | "links" | "history";

/**
 * One task, everything about it, one sheet.
 *
 * Four panes rather than four screens: a task is a small thing and pushing a
 * route for it would lose the reader's place in the schedule they were reading.
 * The panes are the four questions actually asked of a task — where is it, what
 * do I change, what is it waiting on, and why did it move.
 */
export default function TaskSheet({
  open,
  projectId,
  task,
  cost,
  phases,
  tasks,
  dependencies,
  revisions,
  trades,
  contacts = [],
  calendar,
  baselined,
  onClose,
  onChanged,
  onMove,
}: {
  open: boolean;
  projectId: string;
  task: ScheduledTask | null;
  cost?: TaskCostRow;
  phases: ProjectPhase[];
  tasks: Task[];
  dependencies: TaskDependency[];
  revisions: TaskRevision[];
  trades: TradeLookup[];
  /** The people register (migration 0020), for the assignee picker. */
  contacts?: Contact[];
  calendar: WorkCalendar;
  baselined: boolean;
  onClose: () => void;
  onChanged: () => void;
  onMove: () => void;
}) {
  const toast = useToast();
  const [pane, setPane] = useState<Pane>("detail");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [signing, setSigning] = useState(false);

  if (!task) return null;

  /**
   * Sign this stage off (migration 0020).
   *
   * A rejection needs a note — a rejection nobody can act on is just a
   * refusal — so this asks for one rather than letting the server 422 after
   * the tap. Everything else is optional.
   */
  async function sign(outcome: SignoffOutcome) {
    let note: string | null = null;
    if (outcome === "rejected") {
      note = window.prompt("What needs putting right?");
      // Cancelled, or nothing typed. Do not record a rejection with no reason.
      if (!note?.trim()) return;
    }
    setSigning(true);
    try {
      await apiFetch(
        `/api/projects/${projectId}/schedule/tasks/${task!.id}/signoff`,
        { method: "POST", body: JSON.stringify({ outcome, note }) }
      );
      toast(`Recorded: ${SIGNOFF_OUTCOME_LABELS[outcome]}`, "success");
      onChanged();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not sign off", "error");
    } finally {
      setSigning(false);
    }
  }

  const mine = revisions.filter((r) => r.task_id === task.id);
  const linkCount = dependencies.filter((d) => d.successor_id === task.id).length;

  async function remove() {
    try {
      await apiFetch(
        `/api/projects/${projectId}/schedule/tasks/${task!.id}`,
        { method: "DELETE" }
      );
      toast("Task deleted", "success");
      onChanged();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Delete failed", "error");
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={task.name}
        description={
          [task.trade, task.is_critical ? "On the critical path" : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        size="lg"
      >
        <div className="space-y-4">
          <SegmentedControl
            fill
            label="Task section"
            value={pane}
            onChange={setPane}
            options={[
              { value: "detail", label: "Detail" },
              { value: "edit", label: "Edit" },
              { value: "links", label: `Waits for${linkCount ? ` (${linkCount})` : ""}` },
              { value: "history", label: `History${mine.length ? ` (${mine.length})` : ""}` },
            ]}
          />

          {pane === "detail" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge label={task.status} tone={statusTone(task.status)} />
                {task.is_critical ? <Badge label="Critical" tone="bad" /> : null}
                {/* WHY it is blocked, not just that it is (migration 0020).
                    The two send you to chase different people: one is a trade
                    who has not finished, the other is a signature nobody has
                    given, and a badge saying only "Blocked" hides which. */}
                {task.is_blocked ? (
                  <Badge
                    label={
                      task.blocked_reason === "signoff"
                        ? "Waiting on sign-off"
                        : "Blocked"
                    }
                    tone="warn"
                  />
                ) : null}
                {task.signoff ? (
                  <Badge
                    label={SIGNOFF_OUTCOME_LABELS[task.signoff.outcome]}
                    tone={
                      task.signoff.outcome === "rejected"
                        ? "bad"
                        : task.signoff.outcome === "approved"
                          ? "good"
                          : "warn"
                    }
                  />
                ) : null}
                {task.weather_sensitive ? (
                  <Badge label="Weather dependent" tone="info" />
                ) : null}
              </div>

              <dl className="card-flush row-divide">
                <Row
                  label="Scheduled"
                  value={`${fmtDate(task.computed_start)} → ${fmtDate(task.computed_end)}`}
                />
                <Row
                  label="Actual"
                  value={
                    task.actual_start
                      ? `${fmtDate(task.actual_start)} → ${
                          task.actual_end ? fmtDate(task.actual_end) : "still open"
                        }`
                      : "Not started"
                  }
                />
                <Row
                  label="Float"
                  value={
                    task.total_float === null
                      ? "—"
                      : task.total_float <= 0
                        ? "None — this drives the finish date"
                        : `${task.total_float} working ${
                            task.total_float === 1 ? "day" : "days"
                          } of slack`
                  }
                />
                {task.drift_end_days !== null ? (
                  <Row
                    label="Against baseline"
                    value={
                      task.drift_end_days === 0
                        ? "On baseline"
                        : `${Math.abs(task.drift_end_days)} ${
                            Math.abs(task.drift_end_days) === 1 ? "day" : "days"
                          } ${task.drift_end_days > 0 ? "late" : "early"}`
                    }
                    tone={task.drift_end_days > 0 ? "bad" : "good"}
                  />
                ) : null}
                <Row label="Progress" value={`${Number(task.progress_pct)}%`} />
                {task.lead_time_days ? (
                  <Row
                    label="Lead time"
                    value={`${task.lead_time_days} days — order well before it starts`}
                  />
                ) : null}
              </dl>

              {/* Money, on the same basis as the rest of the app, with the one
                  thing that is different about it said out loud: the budget is
                  ex VAT, so the comparison is against net. */}
              {cost ? (
                <div className="card">
                  <p className="eyebrow mb-2.5">Money on this task</p>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Figure label={`${BUDGET.label} (ex VAT)`} value={cost.budget} />
                    <Figure label="Cost (ex VAT)" value={cost.net} />
                    <Figure label={MONEY.paid.label} value={cost.paid} />
                    <Figure
                      label={MONEY.owed.label}
                      value={cost.owed}
                      tone={cost.owed > 0.001 ? "bad" : "good"}
                    />
                  </dl>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200/70 pt-3">
                    <span className="text-[0.8125rem] text-gray-500">
                      {cost.line_count}{" "}
                      {cost.line_count === 1 ? "line" : "lines"} tagged
                    </span>
                    <VarianceChip row={cost} />
                  </div>
                </div>
              ) : null}

              {task.notes ? (
                <p className="text-sm leading-relaxed text-gray-600">{task.notes}</p>
              ) : null}

              {/* Sign-off (migration 0020). Shown here, on the detail pane,
                  rather than as a fifth segment: it is one action and a short
                  record, not a section.

                  The note about permissions is not padding. This app has no
                  roles — signing in is the entire authorisation model
                  (about.md §9.1) — and the phrase "sign off" implies otherwise
                  strongly enough that somebody will assume a check exists. */}
              <div className="card">
                <p className="eyebrow mb-2.5">Sign-off</p>
                {task.signoff ? (
                  <p className="text-[0.8125rem] leading-relaxed text-gray-600">
                    <span className="font-semibold text-gray-900">
                      {SIGNOFF_OUTCOME_LABELS[task.signoff.outcome]}
                    </span>{" "}
                    on {fmtDate(task.signoff.signed_at.slice(0, 10))}
                    {task.signoff.note ? ` — ${task.signoff.note}` : ""}
                  </p>
                ) : (
                  <p className="text-[0.8125rem] leading-relaxed text-gray-500">
                    Not signed off. Anything waiting on this with a
                    &ldquo;needs sign-off&rdquo; link stays blocked.
                  </p>
                )}
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {SIGNOFF_OUTCOMES.map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      disabled={signing}
                      onClick={() => sign(outcome)}
                      className={
                        outcome === "rejected"
                          ? "btn btn-danger-soft btn-sm"
                          : "btn btn-secondary btn-sm"
                      }
                    >
                      {SIGNOFF_OUTCOME_LABELS[outcome]}
                    </button>
                  ))}
                </div>
                <p className="hint mt-2">
                  Records who signed and when. It <strong>enforces
                  nothing</strong> — this workspace has no roles, so anyone
                  signed in can sign anything off.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary btn-sm" onClick={onMove}>
                  <Icon name="calendar" size={15} />
                  Move this task
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPane("edit")}
                >
                  <Icon name="edit" size={15} />
                  Edit
                </button>
                <button
                  type="button"
                  className="btn-danger-soft btn-sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="trash" size={15} />
                  Delete
                </button>
              </div>
            </div>
          )}

          {pane === "edit" && (
            <TaskForm
              projectId={projectId}
              phases={phases}
              trades={trades}
              contacts={contacts}
              calendar={calendar}
              task={task}
              baselined={baselined}
              onSaved={() => {
                onChanged();
                setPane("detail");
              }}
              onCancel={() => setPane("detail")}
            />
          )}

          {pane === "links" && (
            <DependencyEditor
              projectId={projectId}
              task={task}
              tasks={tasks}
              dependencies={dependencies}
              onChanged={onChanged}
            />
          )}

          {pane === "history" && <TaskHistory revisions={mine} />}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete task"
        danger
        confirmLabel="Delete task"
        message={
          <>
            This removes <strong>{task.name}</strong>, its links and its history.
            Any invoice lines tagged to it are <strong>kept</strong> — they move
            back into the untagged total rather than being deleted.
          </>
        }
        onConfirm={() => {
          setConfirmDelete(false);
          remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

function statusTone(status: string) {
  if (status === "Complete") return "good" as const;
  if (status === "Blocked") return "bad" as const;
  if (status === "In progress") return "warn" as const;
  if (status === "Cancelled") return "neutral" as const;
  return "info" as const;
}

function Row({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-3">
      <dt className="shrink-0 text-[0.8125rem] text-gray-500">{label}</dt>
      <dd
        className={`text-right text-[0.9375rem] font-semibold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-700"
              : "text-gray-900"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs font-medium text-gray-400">{label}</dt>
      <dd
        className={`tnum truncate text-[0.9375rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-600"
              : "text-gray-900"
        }`}
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}
