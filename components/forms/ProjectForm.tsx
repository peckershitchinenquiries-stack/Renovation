"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateProject, hasErrors } from "@/lib/validation";
import { useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/States";
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">
          Name *
        </label>
        <input
          id="name"
          className="input"
          maxLength={200}
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="e.g. 46 Glenferrie Rd"
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>

      <div>
        <label className="label" htmlFor="target_budget">
          Target Budget (£) <span className="text-gray-400">— optional</span>
        </label>
        <input
          id="target_budget"
          type="number"
          min={0}
          step="0.01"
          className="input"
          value={form.target_budget}
          onChange={(e) => set("target_budget", e.target.value)}
          placeholder="Your spend ceiling, if you have one"
        />
        {errors.target_budget && (
          <p className="field-error">{errors.target_budget}</p>
        )}
      </div>

      <div>
        <label className="label" htmlFor="status">
          Status
        </label>
        <select
          id="status"
          className="input"
          value={form.status}
          onChange={(e) => set("status", e.target.value)}
        >
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="notes">
          Notes
        </label>
        <textarea
          id="notes"
          className="input"
          rows={3}
          value={form.notes ?? ""}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary">
          {saving && <Spinner />}
          {editing ? "Save changes" : "Create project"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push(editing ? `/projects/${project!.id}` : "/dashboard")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
