"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validatePhase, hasErrors } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import { PHASE_COLOURS, type ProjectPhase } from "@/types";

/**
 * A stage of the job — demo, first fix, second fix, snagging.
 *
 * The set is editable rather than hard-coded because the spec names those four
 * as *examples* and every job has its own. A phase carries its own target
 * dates, independent of the tasks inside it; its ACTUAL dates are derived from
 * those tasks and are never typed, which is why there are no actual-date
 * fields on this form.
 */

const COLOUR_LABELS: Record<(typeof PHASE_COLOURS)[number], string> = {
  slate: "Grey",
  emerald: "Green",
  amber: "Amber",
  blue: "Blue",
  violet: "Violet",
  rose: "Pink",
  teal: "Teal",
  orange: "Orange",
};

export default function PhaseForm({
  projectId,
  phase,
  onSaved,
  onCancel,
}: {
  projectId: string;
  phase?: ProjectPhase;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(phase);
  const [form, setForm] = useState({
    name: phase?.name ?? "",
    colour: phase?.colour ?? "",
    target_start: phase?.target_start ?? "",
    target_end: phase?.target_end ?? "",
    notes: phase?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validatePhase(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/projects/${projectId}/schedule/phases/${phase!.id}`
          : `/api/projects/${projectId}/schedule/phases`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      toast(editing ? "Phase updated" : "Phase added", "success");
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
        <label className="label" htmlFor="phase-name">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="phase-name"
          className={`input ${errors.name ? "input-invalid" : ""}`}
          maxLength={120}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. First fix"
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="phase-start">
            Target start
          </label>
          <DatePicker
            id="phase-start"
            title="Target start"
            placeholder="No target"
            value={form.target_start}
            onChange={(v) => set("target_start", v)}
          />
        </div>
        <div>
          <label className="label" htmlFor="phase-end">
            Target end
          </label>
          <DatePicker
            id="phase-end"
            title="Target end"
            placeholder="No target"
            value={form.target_end}
            onChange={(v) => set("target_end", v)}
          />
          {errors.target_end && <p className="field-error">{errors.target_end}</p>}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="phase-colour">
          Colour on the chart
        </label>
        <Select
          id="phase-colour"
          title="Colour"
          placeholder="Pick one for me"
          clearable
          value={form.colour}
          onChange={(v) => set("colour", v)}
          options={PHASE_COLOURS.map((c) => ({
            value: c,
            label: COLOUR_LABELS[c],
          }))}
        />
      </div>

      <div>
        <label className="label" htmlFor="phase-notes">
          Notes
        </label>
        <textarea
          id="phase-notes"
          className="textarea"
          rows={2}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Add phase"}
        </button>
      </div>
    </form>
  );
}
