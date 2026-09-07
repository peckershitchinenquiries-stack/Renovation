"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
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
  type ScheduledTask,
  type ShiftPreview,
} from "@/types";

/**
 * Move a task, see what it drags with it, then decide.
 *
 * The dangerous version of the spec's "knock-on effect" silently rewrites
 * twenty rows and tells you afterwards. This is the other one: the preview is
 * computed by the server from the same request that will save it, nothing is
 * written until "Apply", and the list of what will move is shown in full
 * beforehand — including the ones that will NOT move, by their absence.
 *
 * On a phone this is also how a bar gets moved at all: dragging a four-pixel
 * bar with a thumb fights the page scroll and is imprecise, so the chart
 * selects and this sheet edits. Same API, same preview, same confirmation.
 */
export default function ShiftDialog({
  open,
  projectId,
  task,
  baselined,
  onClose,
  onApplied,
}: {
  open: boolean;
  projectId: string;
  task: ScheduledTask | null;
  /** Whether this task has a baseline — decides if a reason is compulsory. */
  baselined: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const toast = useToast();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [preview, setPreview] = useState<ShiftPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset to the task's current dates each time the sheet opens, so a second
  // move never starts from the last one's half-finished state.
  useEffect(() => {
    if (!open || !task) return;
    setStart(task.computed_start ?? task.planned_start ?? "");
    setEnd(task.computed_end ?? task.planned_end ?? "");
    setReasonCode("");
    setReasonNote("");
    setPreview(null);
    setErrors({});
  }, [open, task]);

  const runPreview = useCallback(async () => {
    if (!task || !start) return;
    setLoading(true);
    try {
      const result = await apiFetch<ShiftPreview>(
        `/api/projects/${projectId}/schedule/shift`,
        {
          method: "POST",
          body: JSON.stringify({
            task_id: task.id,
            planned_start: start,
            planned_end: end || null,
            confirm: false,
          }),
        }
      );
      setPreview(result);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not preview", "error");
    } finally {
      setLoading(false);
    }
  }, [projectId, task, start, end, toast]);

  // Preview as the dates change. The request writes nothing, so running it on
  // every edit costs a round trip and no risk — and a preview the user has to
  // ask for is a preview the user skips.
  useEffect(() => {
    if (!open || !task || !start) return;
    const id = setTimeout(runPreview, 250);
    return () => clearTimeout(id);
  }, [open, task, start, end, runPreview]);

  async function apply() {
    if (!task) return;
    setSaving(true);
    setErrors({});
    try {
      await apiFetch(`/api/projects/${projectId}/schedule/shift`, {
        method: "POST",
        body: JSON.stringify({
          task_id: task.id,
          planned_start: start,
          planned_end: end || null,
          reason_code: reasonCode || null,
          reason_note: reasonNote || null,
          confirm: true,
        }),
      });
      toast("Schedule updated", "success");
      onApplied();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!task) return null;

  const moved = preview?.rows ?? [];
  const knockOns = moved.filter((r) => r.knock_on);
  const completionDays = preview?.completion_days ?? 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={task.name}
      description="Move this task and see what follows"
      size="md"
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || moved.length === 0}
            onClick={apply}
            className="btn-primary flex-1"
          >
            {saving ? <Spinner /> : null}
            {moved.length === 0
              ? "Nothing to apply"
              : `Apply ${moved.length} ${moved.length === 1 ? "change" : "changes"}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="shift-start">
              New start
            </label>
            <DatePicker
              id="shift-start"
              title="New start"
              clearable={false}
              value={start}
              onChange={setStart}
            />
          </div>
          <div>
            <label className="label" htmlFor="shift-end">
              New end
            </label>
            <DatePicker
              id="shift-end"
              title="New end"
              clearable={false}
              value={end}
              onChange={setEnd}
            />
          </div>
        </div>

        {loading && !preview ? (
          <p className="muted flex items-center gap-2">
            <Spinner /> Working out what moves…
          </p>
        ) : null}

        {preview ? (
          <>
            {/* The headline: what this does to the finish date. A slip absorbed
                by float moves tasks without moving completion, and saying so is
                the difference between a schedule and a list of dates. */}
            <div
              className={`rounded-2xl px-4 py-3 ring-1 ring-inset ${
                completionDays > 0
                  ? "bg-red-50 text-red-800 ring-red-600/15"
                  : completionDays < 0
                    ? "bg-emerald-50 text-emerald-800 ring-emerald-600/15"
                    : "bg-gray-100 text-gray-700 ring-gray-500/10"
              }`}
            >
              <p className="text-sm font-bold">
                {completionDays === 0
                  ? "Completion does not move"
                  : completionDays > 0
                    ? `Completion goes out ${completionDays} ${
                        completionDays === 1 ? "day" : "days"
                      }`
                    : `Completion comes in ${Math.abs(completionDays)} ${
                        Math.abs(completionDays) === 1 ? "day" : "days"
                      }`}
              </p>
              <p className="mt-0.5 text-[0.8125rem]">
                {fmtDate(preview.completion_before)} →{" "}
                {fmtDate(preview.completion_after)}
                {completionDays === 0 && knockOns.length > 0
                  ? " — the slack absorbs it"
                  : ""}
              </p>
            </div>

            {preview.cost_impact.days > 0 ? (
              <CostImpactChip impact={preview.cost_impact} />
            ) : null}

            {moved.length === 0 ? (
              <p className="muted">Those are the dates it already has.</p>
            ) : (
              <div>
                <p className="eyebrow mb-2">
                  {moved.length} {moved.length === 1 ? "task moves" : "tasks move"}
                  {knockOns.length > 0
                    ? ` · ${knockOns.length} knocked on`
                    : ""}
                </p>
                <ul className="card-flush row-divide">
                  {moved.map((row) => (
                    <li key={row.task_id} className="flex items-center gap-3 px-4 py-3">
                      <Icon
                        name={row.knock_on ? "link" : "edit"}
                        size={16}
                        className={`shrink-0 ${
                          row.knock_on ? "text-amber-500" : "text-brand-700"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem] font-semibold text-gray-900">
                          {row.task_name}
                        </span>
                        <span className="mt-0.5 block text-[0.8125rem] text-gray-500">
                          {fmtDate(row.from_start)} → {fmtDate(row.to_start)}
                        </span>
                      </span>
                      <span
                        className={`tnum shrink-0 text-sm font-bold ${
                          row.days > 0 ? "text-red-600" : "text-emerald-600"
                        }`}
                      >
                        {row.days > 0 ? "+" : ""}
                        {row.days}d
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Compulsory once a baseline exists, and the same rule the server
                applies — so the two can never disagree about whether this save
                is allowed. */}
            {baselined && moved.length > 0 ? (
              <fieldset className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
                <legend className="eyebrow mb-2.5 text-amber-800">
                  Why is it moving?
                </legend>
                <Select
                  title="Reason"
                  placeholder="Pick a reason"
                  invalid={Boolean(errors.reason_code)}
                  value={reasonCode}
                  onChange={setReasonCode}
                  options={REASON_CODES.map((c) => ({
                    value: c,
                    label: REASON_CODE_LABELS[c],
                  }))}
                />
                {errors.reason_code && (
                  <p className="field-error">{errors.reason_code}</p>
                )}
                <input
                  className={`input mt-3 ${errors.reason_note ? "input-invalid" : ""}`}
                  placeholder="Note — e.g. steels arrived a week late"
                  value={reasonNote}
                  onChange={(e) => setReasonNote(e.target.value)}
                />
                {errors.reason_note && (
                  <p className="field-error">{errors.reason_note}</p>
                )}
                <p className="hint text-amber-900/70">
                  Every task that moves because of this one is logged with the
                  same reason, so the history says why — not just that it did.
                </p>
              </fieldset>
            ) : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
