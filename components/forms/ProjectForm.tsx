"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateProject, hasErrors } from "@/lib/validation";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/States";
import { Select } from "@/components/ui/Select";
import { PROJECT_STATUSES, type Project } from "@/types";

export default function ProjectForm({ project }: { project?: Project }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(project);

  const [form, setForm] = useState({
    name: project?.name ?? "",
    target_budget: project?.target_budget?.toString() ?? "",
    status: project?.status ?? "active",
    notes: project?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateProject(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      const saved = await apiFetch<Project>(
        editing ? `/api/projects/${project!.id}` : "/api/projects",
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      toast(editing ? "Project updated" : "Project created", "success");
      router.push(`/projects/${saved.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Something went wrong", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="name"
            className={`input ${errors.name ? "input-invalid" : ""}`}
            maxLength={200}
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. 46 Glenferrie Rd"
          />
          {errors.name ? <p className="field-error">{errors.name}</p> : null}
        </div>

        <div>
          <label className="label" htmlFor="target_budget">
            Target budget{" "}
            <span className="font-normal text-gray-400">— optional</span>
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-gray-400">
              £
            </span>
            <input
              id="target_budget"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              className={`input tnum pl-8 ${errors.target_budget ? "input-invalid" : ""}`}
              value={form.target_budget}
              onChange={(e) => set("target_budget", e.target.value)}
              placeholder="0.00"
            />
          </div>
          {errors.target_budget ? (
            <p className="field-error">{errors.target_budget}</p>
          ) : (
            <p className="hint">Your spend ceiling, if you have one.</p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="status">
            Status
          </label>
          <Select
            id="status"
            title="Project status"
            value={form.status}
            onChange={(v) => set("status", v)}
            options={PROJECT_STATUSES.map((s) => ({ value: s, label: s }))}
          />
        </div>

        <div>
          <label className="label" htmlFor="notes">
            Notes
          </label>
          <textarea
            id="notes"
            className="textarea"
            rows={3}
            placeholder="Anything worth remembering about this job"
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </div>
      </div>

      {/* Stacked and full width: on a phone a submit button is easiest to hit
          when it spans the screen, and the cancel below it is then impossible
          to mistake for the primary action. */}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row-reverse sm:justify-end">
        <button
          type="button"
          className="btn-secondary sm:w-auto"
          onClick={() =>
            router.push(editing ? `/projects/${project!.id}` : "/dashboard")
          }
        >
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary sm:w-auto">
          {saving ? <Spinner /> : null}
          {editing ? "Save changes" : "Create project"}
        </button>
      </div>
    </form>
  );
}
