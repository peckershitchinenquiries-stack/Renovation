"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { calendarDaysBetween, isISODate } from "@/lib/schedule";
import { fmtDate } from "@/components/project/format";
import { Sheet } from "@/components/ui/Sheet";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { CostImpactChip } from "./CostImpactChip";
import {
  REASON_CODES,
  REASON_CODE_LABELS,
  type CostImpact,
  type ScheduleResult,
  type ScheduledTask,
} from "@/types";

/**
 * "What if" — test a delay before committing it.
 *
 * This is nearly free by construction, and that is the whole reason the
 * scheduling maths was kept pure in `lib/schedule.ts`. A scenario is the same
 * `scheduleProject` run over a modified copy of the bundle that is never saved:
 * no scenario table, no draft rows, no second code path that could disagree
 * with the real one.
 *
 * **Nothing is written to the database for a scenario.** A saved, named,
 * shareable scenario is a different and much larger feature and is deliberately
 * out of scope. Discard throws the draft away; Apply replays the same edits
 * through the ordinary `POST …/schedule/shift` route, one per edited task, with
 * the reason attached — so the real schedule is only ever changed by the one
 * path that logs revisions.
 */

export interface ScenarioEdit {
  task_id: string;
  planned_start: string | null;
  planned_end: string | null;
}

export default function ScenarioPanel({
  projectId,
  edits,
  base,
  draft,
  costImpact,
  tasksById,
  onDiscard,
  onApplied,
  onRemoveEdit,
}: {
  projectId: string;
  edits: ScenarioEdit[];
  /** The live schedule, for comparison. */
  base: ScheduleResult;
  /** The scenario's schedule, computed but never saved. */
  draft: ScheduleResult;
  costImpact: CostImpact;
  tasksById: Map<string, ScheduledTask>;
  onDiscard: () => void;
  onApplied: () => void;
  onRemoveEdit: (taskId: string) => void;
}) {
  const toast = useToast();
  const [applying, setApplying] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");

  const completionDays =
    isISODate(base.completion) && isISODate(draft.completion)
      ? calendarDaysBetween(base.completion, draft.completion)
      : 0;

  // Tasks that have no slack in the scenario but did in reality. This is the
  // figure a scenario is actually run to find: not "how late", but "what have
  // I just made fragile".
  const wasCritical = new Set(base.critical_task_ids);
  const newlyCritical = draft.critical_task_ids.filter((id) => !wasCritical.has(id));

  // Everything the scenario moves, including the knock-ons — computed by
  // comparing the two schedules rather than tracked, so it cannot fall out of
  // step with what the engine actually did.
  const baseById = new Map(base.tasks.map((t) => [t.id, t]));
  const moved = draft.tasks.filter((t) => {
    const was = baseById.get(t.id);
    return (
      was &&
      (was.computed_start !== t.computed_start ||
        was.computed_end !== t.computed_end)
    );
  });

  async function apply() {
    setApplying(true);
    try {
      // One ordinary shift request per edited task, in the order they were
      // made. Sequential rather than parallel on purpose: each one recomputes
      // the schedule server-side from what the previous one wrote, which is
      // exactly how the draft was built.
      for (const edit of edits) {
        await apiFetch(`/api/projects/${projectId}/schedule/shift`, {
          method: "POST",
          body: JSON.stringify({
            task_id: edit.task_id,
            planned_start: edit.planned_start,
            planned_end: edit.planned_end,
            reason_code: reasonCode || null,
            reason_note: reasonNote || null,
            confirm: true,
          }),
        });
      }
      toast("Scenario applied to the live schedule", "success");
      setConfirmOpen(false);
      onApplied();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Could not apply the scenario",
        "error"
      );
    } finally {
      setApplying(false);
    }
  }

  return (
    <>
      <div className="rounded-2xl bg-violet-50 p-4 ring-1 ring-inset ring-violet-600/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-violet-900">
              What if — nothing is saved
            </p>
            <p className="mt-0.5 text-[0.8125rem] leading-snug text-violet-800">
              {edits.length === 0
                ? "Tap or drag a bar to try a delay. The live schedule is untouched until you apply."
                : `${edits.length} ${
                    edits.length === 1 ? "change" : "changes"
                  }, moving ${moved.length} ${
                    moved.length === 1 ? "task" : "tasks"
                  } in total.`}
            </p>
          </div>
          <Icon name="sparkle" size={20} className="shrink-0 text-violet-500" />
        </div>

        {edits.length > 0 ? (
          <>
            <dl className="mt-3 grid grid-cols-3 gap-3">
              <Delta
                label="Completion"
                value={
                  completionDays === 0
                    ? "no change"
                    : `${completionDays > 0 ? "+" : ""}${completionDays}d`
                }
                tone={completionDays > 0 ? "bad" : completionDays < 0 ? "good" : "flat"}
                hint={fmtDate(draft.completion)}
              />
              <Delta
                label="Cost"
                value={
                  costImpact.unpriced
                    ? "no estimate"
                    : `+${formatCurrency(costImpact.total)}`
                }
                tone={costImpact.total > 0 ? "bad" : "flat"}
                hint={costImpact.unpriced ? "no rate on file" : undefined}
              />
              <Delta
                label="Newly critical"
                value={String(newlyCritical.length)}
                tone={newlyCritical.length > 0 ? "bad" : "flat"}
                hint={
                  newlyCritical.length > 0
                    ? newlyCritical
                        .map((id) => tasksById.get(id)?.name ?? "?")
                        .slice(0, 2)
                        .join(", ")
                    : "no new risk"
                }
              />
            </dl>

            {!costImpact.unpriced && costImpact.basis.length > 0 ? (
              <CostImpactChip impact={costImpact} className="mt-3" />
            ) : null}

            <ul className="mt-3 space-y-1">
              {edits.map((edit) => (
                <li
                  key={edit.task_id}
                  className="flex items-center gap-2 text-[0.8125rem] text-violet-900"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {tasksById.get(edit.task_id)?.name ?? "Task"} →{" "}
                    {fmtDate(edit.planned_start)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveEdit(edit.task_id)}
                    aria-label="Undo this change"
                    className="btn-icon h-8 min-h-0 w-8 min-w-0 text-violet-500"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-secondary btn-sm" onClick={onDiscard}>
            Discard
          </button>
          <button
            type="button"
            disabled={edits.length === 0}
            onClick={() => setConfirmOpen(true)}
            className="btn-primary btn-sm flex-1"
          >
            Apply to the live schedule
          </button>
        </div>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Apply this scenario"
        description={`${edits.length} ${
          edits.length === 1 ? "change" : "changes"
        } will be written, moving ${moved.length} ${
          moved.length === 1 ? "task" : "tasks"
        }`}
        size="sm"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={applying}
              onClick={apply}
              className="btn-primary flex-1"
            >
              {applying ? <Spinner /> : null}
              Apply
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="muted">
            Every task that moves is logged, and the knocked-on ones carry the
            same reason as the change that caused them.
          </p>
          <div>
            <label className="label" htmlFor="scenario-reason">
              Reason
            </label>
            <Select
              id="scenario-reason"
              title="Reason"
              placeholder="Pick a reason"
              clearable
              value={reasonCode}
              onChange={setReasonCode}
              options={REASON_CODES.map((c) => ({
                value: c,
                label: REASON_CODE_LABELS[c],
              }))}
            />
          </div>
          <div>
            <label className="label" htmlFor="scenario-note">
              Note
            </label>
            <input
              id="scenario-note"
              className="input"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="e.g. modelling a two-week steel delay"
            />
          </div>
        </div>
      </Sheet>
    </>
  );
}

function Delta({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone: "good" | "bad" | "flat";
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs font-medium text-violet-700/70">{label}</dt>
      <dd
        className={`tnum truncate text-[0.9375rem] font-bold ${
          tone === "bad"
            ? "text-red-600"
            : tone === "good"
              ? "text-emerald-700"
              : "text-violet-900"
        }`}
      >
        {value}
      </dd>
      {hint ? (
        <dd className="truncate text-2xs text-violet-700/60">{hint}</dd>
      ) : null}
    </div>
  );
}

/** A compact date editor for scenario mode — the phone's equivalent of a drag. */
export function ScenarioEditSheet({
  open,
  task,
  onClose,
  onChange,
}: {
  open: boolean;
  task: ScheduledTask | null;
  onClose: () => void;
  onChange: (edit: ScenarioEdit) => void;
}) {
  const [start, setStart] = useState("");

  return (
    <Sheet
      open={open && task !== null}
      onClose={onClose}
      title={task?.name ?? ""}
      description="Try a new start date. Nothing is saved."
      size="sm"
      footer={
        <button
          type="button"
          disabled={!start}
          onClick={() => {
            if (!task || !start) return;
            onChange({
              task_id: task.id,
              planned_start: start,
              // Left null so the engine re-derives the end from the duration —
              // which is the authoritative field. Pinning both would let a
              // scenario silently change how long a task takes as well as when
              // it starts, and only one of those was asked for.
              planned_end: null,
            });
            setStart("");
            onClose();
          }}
          className="btn-primary btn-block"
        >
          Add to the scenario
        </button>
      }
    >
      <div className="space-y-3">
        <p className="muted">
          Currently {fmtDate(task?.computed_start ?? null)} →{" "}
          {fmtDate(task?.computed_end ?? null)}
          {task?.total_float && task.total_float > 0
            ? ` · ${task.total_float} days of slack`
            : " · no slack"}
        </p>
        <div>
          <label className="label" htmlFor="scenario-start">
            New start
          </label>
          <DatePicker
            id="scenario-start"
            title="New start"
            clearable={false}
            value={start}
            onChange={setStart}
          />
        </div>
      </div>
    </Sheet>
  );
}
