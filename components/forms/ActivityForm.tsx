"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateActivity, hasErrors, todayISO } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABELS } from "@/types";

/**
 * One entry in the activity log (migration 0022).
 *
 * There is no edit path anywhere in the app for these — this form only ever
 * creates. The value of a log is entirely in its being trustworthy, and a log
 * that can be quietly reworded six months later answers nothing. A mistake is
 * corrected by deleting the entry and writing a new one, which at least leaves
 * the correction visible as a correction.
 */
export default function ActivityForm({
  projectId,
  phases = [],
  tasks = [],
  contacts = [],
  onSaved,
  onCancel,
}: {
  projectId: string;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    kind: "note" as (typeof ACTIVITY_KINDS)[number],
    summary: "",
    detail: "",
    // Defaults to today, because most things are written down the day they
    // happen — but it is editable, because the ones that are not are exactly
    // the ones worth having right.
    occurred_at: todayISO(),
    contact_id: "",
    task_id: "",
    phase_id: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateActivity(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/activity`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      toast("Logged", "success");
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="activity-kind">
            What was it
          </label>
          <Select
            id="activity-kind"
            title="Kind of entry"
            value={form.kind}
            onChange={(v) => set("kind", v)}
            options={ACTIVITY_KINDS.map((k) => ({
              value: k,
              label: ACTIVITY_KIND_LABELS[k],
            }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="activity-date">
            When it happened
          </label>
          <DatePicker
            id="activity-date"
            title="When it happened"
            clearable={false}
            value={form.occurred_at}
            onChange={(v) => set("occurred_at", v)}
            invalid={Boolean(errors.occurred_at)}
          />
          {errors.occurred_at && (
            <p className="field-error">{errors.occurred_at}</p>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="activity-summary">
          One line <span className="text-red-500">*</span>
        </label>
        <input
          id="activity-summary"
          className={`input ${errors.summary ? "input-invalid" : ""}`}
          maxLength={300}
          value={form.summary}
          onChange={(e) => set("summary", e.target.value)}
          placeholder="Building inspector wants the trench left open"
        />
        {errors.summary && <p className="field-error">{errors.summary}</p>}
        <p className="hint">
          This is what shows on the timeline. Write it so it makes sense to
          somebody reading it next year.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="activity-detail">
          Detail
        </label>
        <textarea
          id="activity-detail"
          className="textarea"
          rows={3}
          value={form.detail}
          onChange={(e) => set("detail", e.target.value)}
          placeholder="What was said, what was agreed, who else was there."
        />
      </div>

      {contacts.length > 0 ? (
        <div>
          <label className="label" htmlFor="activity-contact">
            Who with
          </label>
          <Select
            id="activity-contact"
            title="Person"
            placeholder="Nobody in particular"
            clearable
            value={form.contact_id}
            onChange={(v) => set("contact_id", v)}
            options={contacts.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <label className="label" htmlFor="activity-task">
            About which task
          </label>
          <Select
            id="activity-task"
            title="Task"
            placeholder="Not about one task"
            clearable
            value={form.task_id}
            onChange={(v) => set("task_id", v)}
            options={tasks.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      ) : null}

      {phases.length > 0 ? (
        <div>
          <label className="label" htmlFor="activity-phase">
            Phase
          </label>
          <Select
            id="activity-phase"
            title="Phase"
            placeholder="Not about one phase"
            clearable
            value={form.phase_id}
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
          Add to the log
        </button>
      </div>
    </form>
  );
}
