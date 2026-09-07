"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateVariation, hasErrors, todayISO } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import {
  VARIATION_STATUSES,
  VARIATION_STATUS_LABELS,
  type Variation,
} from "@/types";

/**
 * One change to the job (migration 0024).
 *
 * Both impacts are SIGNED, and the form says so, because a variation can be an
 * omission: taking the second bathroom out of the scope is worth −£6,000 and
 * −5 days. A log that can only record additions overstates the job.
 *
 * The figures typed here are what was AGREED — they are never derived from
 * what has since been spent. The screen shows the linked task's actual cost
 * beside them, so the only question anybody opens a variations log to answer
 * ("did those two match?") can actually be answered.
 */
export default function VariationForm({
  projectId,
  variation,
  phases = [],
  tasks = [],
  onSaved,
  onCancel,
}: {
  projectId: string;
  variation?: Variation;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(variation);
  const [form, setForm] = useState({
    ref: variation?.ref ?? "",
    title: variation?.title ?? "",
    description: variation?.description ?? "",
    requested_by: variation?.requested_by ?? "",
    raised_on: variation?.raised_on ?? todayISO(),
    status: variation?.status ?? "proposed",
    approved_on: variation?.approved_on ?? "",
    cost_impact: variation?.cost_impact?.toString() ?? "",
    days_impact: variation?.days_impact?.toString() ?? "",
    task_id: variation?.task_id ?? "",
    phase_id: variation?.phase_id ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  // Approving fills the date; anything else clears it. The CHECK constraint
  // refuses an approval date on a variation that is not approved, so leaving a
  // stale one behind would make an otherwise sensible edit fail at the
  // database with a message nobody can act on.
  function setStatus(next: string) {
    setForm((f) => ({
      ...f,
      status: next as Variation["status"],
      approved_on:
        next === "approved" ? f.approved_on || todayISO() : "",
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateVariation(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/projects/${projectId}/variations/${variation!.id}`
          : `/api/projects/${projectId}/variations`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      toast(editing ? "Variation saved" : "Variation raised", "success");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="var-ref">
            Reference
          </label>
          <input
            id="var-ref"
            className={`input ${errors.ref ? "input-invalid" : ""}`}
            value={form.ref ?? ""}
            onChange={(e) => set("ref", e.target.value)}
            placeholder="VO 7"
          />
          {errors.ref && <p className="field-error">{errors.ref}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="var-title">
            What changed <span className="text-red-500">*</span>
          </label>
          <input
            id="var-title"
            className={`input ${errors.title ? "input-invalid" : ""}`}
            maxLength={200}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Moved the kitchen door to the side wall"
          />
          {errors.title && <p className="field-error">{errors.title}</p>}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="var-description">
          Why
        </label>
        <textarea
          id="var-description"
          className="textarea"
          rows={3}
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Who asked for it and what problem it solved."
        />
        <p className="hint">
          The <strong>why</strong> is the whole point. What changed is already
          in the drawings; why it changed is the thing nobody writes down and
          everybody argues about later.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="var-requested">
            Asked for by
          </label>
          <input
            id="var-requested"
            className="input"
            value={form.requested_by ?? ""}
            onChange={(e) => set("requested_by", e.target.value)}
            placeholder="Client, architect, building inspector"
          />
        </div>
        <div>
          <label className="label" htmlFor="var-raised">
            Raised
          </label>
          <DatePicker
            id="var-raised"
            title="Raised on"
            clearable={false}
            value={form.raised_on}
            onChange={(v) => set("raised_on", v)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="var-cost">
            Cost impact
          </label>
          <input
            id="var-cost"
            type="number"
            inputMode="decimal"
            step="0.01"
            className={`input ${errors.cost_impact ? "input-invalid" : ""}`}
            value={form.cost_impact}
            onChange={(e) => set("cost_impact", e.target.value)}
            placeholder="4000"
          />
          {errors.cost_impact && (
            <p className="field-error">{errors.cost_impact}</p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="var-days">
            Days impact
          </label>
          <input
            id="var-days"
            type="number"
            inputMode="numeric"
            step="1"
            className={`input ${errors.days_impact ? "input-invalid" : ""}`}
            value={form.days_impact}
            onChange={(e) => set("days_impact", e.target.value)}
            placeholder="3"
          />
          {errors.days_impact && (
            <p className="field-error">{errors.days_impact}</p>
          )}
        </div>
      </div>
      <p className="hint -mt-2">
        Both can be <strong>negative</strong>. Taking something out of the scope
        is a variation too, and a log that can only add overstates the job.
        Cost is <strong>ex VAT</strong>, to match the task budgets it is
        compared against.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="var-status">
            Status
          </label>
          <Select
            id="var-status"
            title="Status"
            value={form.status}
            onChange={setStatus}
            options={VARIATION_STATUSES.map((s) => ({
              value: s,
              label: VARIATION_STATUS_LABELS[s],
              hint:
                s === "proposed"
                  ? "Not committed — kept out of the approved total"
                  : s === "withdrawn"
                    ? "Asked for and then dropped"
                    : undefined,
            }))}
          />
        </div>
        {form.status === "approved" ? (
          <div>
            <label className="label" htmlFor="var-approved">
              Approved on
            </label>
            <DatePicker
              id="var-approved"
              title="Approved on"
              value={form.approved_on}
              onChange={(v) => set("approved_on", v)}
              invalid={Boolean(errors.approved_on)}
            />
            {errors.approved_on && (
              <p className="field-error">{errors.approved_on}</p>
            )}
          </div>
        ) : null}
      </div>
      {form.status === "approved" ? (
        <p className="hint -mt-2">
          Your name is recorded against the approval, by the server. Signing in
          is the whole of this app&apos;s permission model — anyone with a login
          can approve a variation.
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <label className="label" htmlFor="var-task">
            Which task it changes
          </label>
          <Select
            id="var-task"
            title="Task"
            placeholder="Not tied to a task"
            clearable
            value={form.task_id ?? ""}
            onChange={(v) => set("task_id", v)}
            options={tasks.map((t) => ({ value: t.id, label: t.name }))}
          />
          <p className="hint">
            Linking it is what makes this worth recording: the screen then shows
            what that task has <em>actually</em> cost and how far it has
            actually drifted, beside what was agreed here.
          </p>
        </div>
      ) : null}

      {phases.length > 0 ? (
        <div>
          <label className="label" htmlFor="var-phase">
            Phase
          </label>
          <Select
            id="var-phase"
            title="Phase"
            placeholder="Not tied to a phase"
            clearable
            value={form.phase_id ?? ""}
            onChange={(v) => set("phase_id", v)}
            options={phases.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Raise variation"}
        </button>
      </div>
    </form>
  );
}
