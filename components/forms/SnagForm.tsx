"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateSnag, hasErrors, todayISO } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import {
  SNAG_SEVERITIES,
  SNAG_SEVERITY_LABELS,
  SNAG_STATUSES,
  SNAG_STATUS_LABELS,
  type Snag,
} from "@/types";

/**
 * One snag (migration 0022).
 *
 * Unlike the activity log, a snag IS editable — and that difference is not an
 * inconsistency. A log entry records something that already happened and is
 * finished; a snag is a live state that is supposed to change as somebody
 * fixes it and somebody else checks the fix.
 *
 * The dates are what make the state accountable, which is why the form asks
 * for them as the status advances rather than stamping them silently: "fixed"
 * with nothing saying when is not a claim anybody can stand behind, and the
 * validator refuses it.
 */
export default function SnagForm({
  projectId,
  snag,
  phases = [],
  tasks = [],
  contacts = [],
  onSaved,
  onCancel,
}: {
  projectId: string;
  snag?: Snag;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(snag);
  const [form, setForm] = useState({
    title: snag?.title ?? "",
    description: snag?.description ?? "",
    location_room: snag?.location_room ?? "",
    phase_id: snag?.phase_id ?? "",
    task_id: snag?.task_id ?? "",
    contact_id: snag?.contact_id ?? "",
    status: snag?.status ?? "open",
    severity: snag?.severity ?? "minor",
    raised_on: snag?.raised_on ?? todayISO(),
    fixed_on: snag?.fixed_on ?? "",
    verified_on: snag?.verified_on ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  // Advancing the status fills the matching date rather than leaving the user
  // to notice a new required field has appeared below the fold. Only when it
  // is empty — a date already recorded is a fact and is never overwritten.
  function setStatus(next: string) {
    setForm((f) => ({
      ...f,
      status: next as Snag["status"],
      fixed_on:
        (next === "fixed" || next === "verified") && !f.fixed_on
          ? todayISO()
          : f.fixed_on,
      verified_on:
        next === "verified" && !f.verified_on ? todayISO() : f.verified_on,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateSnag(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/projects/${projectId}/snags/${snag!.id}`
          : `/api/projects/${projectId}/snags`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      toast(editing ? "Snag updated" : "Snag raised", "success");
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
      <div>
        <label className="label" htmlFor="snag-title">
          What is wrong <span className="text-red-500">*</span>
        </label>
        <input
          id="snag-title"
          className={`input ${errors.title ? "input-invalid" : ""}`}
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="Cracked tile beside the bath"
        />
        {errors.title && <p className="field-error">{errors.title}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="snag-severity">
            Severity
          </label>
          <Select
            id="snag-severity"
            title="Severity"
            value={form.severity}
            onChange={(v) => set("severity", v)}
            options={SNAG_SEVERITIES.map((s) => ({
              value: s,
              label: SNAG_SEVERITY_LABELS[s],
            }))}
          />
          <p className="hint">
            <strong>Safety</strong> is its own level so &ldquo;any open safety
            snags?&rdquo; is one tap rather than a read of every title.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="snag-room">
            Room
          </label>
          <input
            id="snag-room"
            className="input"
            value={form.location_room ?? ""}
            onChange={(e) => set("location_room", e.target.value)}
            placeholder="Bathroom"
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="snag-description">
          Detail
        </label>
        <textarea
          id="snag-description"
          className="textarea"
          rows={3}
          value={form.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
          placeholder="Where exactly, and what putting it right involves."
        />
      </div>

      {contacts.length > 0 ? (
        <div>
          <label className="label" htmlFor="snag-contact">
            Whose it is to fix
          </label>
          <Select
            id="snag-contact"
            title="Responsible"
            placeholder="Not assigned"
            clearable
            value={form.contact_id ?? ""}
            onChange={(v) => set("contact_id", v)}
            options={contacts.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <label className="label" htmlFor="snag-task">
            Task
          </label>
          <Select
            id="snag-task"
            title="Task"
            placeholder="Not tied to a task"
            clearable
            value={form.task_id ?? ""}
            onChange={(v) => set("task_id", v)}
            options={tasks.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      ) : null}

      {phases.length > 0 ? (
        <div>
          <label className="label" htmlFor="snag-phase">
            Phase
          </label>
          <Select
            id="snag-phase"
            title="Phase"
            placeholder="Not tied to a phase"
            clearable
            value={form.phase_id ?? ""}
            onChange={(v) => set("phase_id", v)}
            options={phases.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="snag-status">
          Status
        </label>
        <Select
          id="snag-status"
          title="Status"
          value={form.status}
          onChange={setStatus}
          options={SNAG_STATUSES.map((s) => ({
            value: s,
            label: SNAG_STATUS_LABELS[s],
            hint:
              s === "wont_fix"
                ? "Looked at and deliberately left"
                : s === "verified"
                  ? "Somebody has checked the fix"
                  : undefined,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="snag-raised">
            Raised
          </label>
          <DatePicker
            id="snag-raised"
            title="Raised on"
            clearable={false}
            value={form.raised_on}
            onChange={(v) => set("raised_on", v)}
          />
        </div>
        {form.status === "fixed" || form.status === "verified" ? (
          <div>
            <label className="label" htmlFor="snag-fixed">
              Fixed
            </label>
            <DatePicker
              id="snag-fixed"
              title="Fixed on"
              value={form.fixed_on}
              onChange={(v) => set("fixed_on", v)}
              invalid={Boolean(errors.fixed_on)}
            />
            {errors.fixed_on && <p className="field-error">{errors.fixed_on}</p>}
          </div>
        ) : null}
        {form.status === "verified" ? (
          <div>
            <label className="label" htmlFor="snag-verified">
              Checked
            </label>
            <DatePicker
              id="snag-verified"
              title="Verified on"
              value={form.verified_on}
              onChange={(v) => set("verified_on", v)}
              invalid={Boolean(errors.verified_on)}
            />
            {errors.verified_on && (
              <p className="field-error">{errors.verified_on}</p>
            )}
          </div>
        ) : null}
      </div>
      {form.status === "verified" ? (
        <p className="hint -mt-2">
          Your name is recorded against the check, by the server. Note that
          signing in is the whole of this app&apos;s permission model — anyone
          with a login can verify a snag.
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Raise snag"}
        </button>
      </div>
    </form>
  );
}
