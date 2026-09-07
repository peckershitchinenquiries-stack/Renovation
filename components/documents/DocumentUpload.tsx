"use client";

import { useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateDocument, hasErrors } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { formatBytes } from "@/lib/documents";
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  type DocType,
  type ProjectDocument,
} from "@/types";

/**
 * Add a document, or a new version of one (migration 0021).
 *
 * The file goes STRAIGHT to Supabase Storage with a signed upload URL, never
 * through the Route Handler — Vercel caps serverless request bodies at 4.5MB
 * and a phone photo of a wall is comfortably bigger. This is the same
 * two-step the invoice upload already uses (about.md §8.2):
 *
 *   1. POST the metadata → get a row and a signed URL back
 *   2. PUT the bytes at that URL
 *
 * If step 2 fails the row is deleted again, because a document that points at
 * a file which does not exist will show in the list and fail every time
 * somebody opens it — worse than never having been added.
 */
export default function DocumentUpload({
  projectId,
  supersedes,
  defaultType = "other",
  snagId,
  phases = [],
  tasks = [],
  contacts = [],
  onSaved,
  onCancel,
}: {
  projectId: string;
  /** Set when this is a new revision of an existing document. */
  supersedes?: ProjectDocument;
  defaultType?: DocType;
  /** Set when this is a photo of a snag. */
  snagId?: string;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    // A new version inherits everything except the file: rev C of a drawing is
    // the same drawing, and retyping its title is how a chain ends up with two
    // slightly different names in it.
    title: supersedes?.title ?? "",
    doc_type: (supersedes?.doc_type ?? defaultType) as DocType,
    reference: supersedes?.reference ?? "",
    issued_on: supersedes?.issued_on ?? "",
    expires_on: supersedes?.expires_on ?? "",
    taken_at: supersedes?.taken_at ?? "",
    location_room: supersedes?.location_room ?? "",
    phase_id: supersedes?.phase_id ?? "",
    task_id: supersedes?.task_id ?? "",
    contact_id: supersedes?.contact_id ?? "",
    notes: "",
    // Scoped to the project unless it genuinely belongs to the business — a
    // company insurance certificate is not one job's.
    project_scoped: supersedes ? supersedes.project_id !== null : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const isPhoto = form.doc_type === "photo";
  const set = (field: string, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  function chooseFile(next: File | null) {
    setFile(next);
    // Fill the title from the filename the first time, minus its extension.
    // A prefilled title somebody can correct beats an empty required field.
    if (next && !form.title.trim())
      set("title", next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErrors({ file: "Choose a file" });
      return;
    }

    const payload = {
      ...form,
      project_id: form.project_scoped ? projectId : null,
      snag_id: snagId ?? null,
      supersedes_id: supersedes?.id ?? null,
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      file_size: file.size,
    };

    const v = validateDocument(payload);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    let createdId: string | null = null;
    try {
      const created = await apiFetch<{
        document: ProjectDocument;
        upload_url: string;
      }>("/api/documents/upload-url", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      createdId = created.document.id;

      const put = await fetch(created.upload_url, {
        method: "PUT",
        headers: { "Content-Type": payload.mime_type },
        body: file,
      });
      if (!put.ok) throw new Error(`The file did not upload (${put.status})`);

      toast(supersedes ? "New version added" : "Document added", "success");
      onSaved();
    } catch (err) {
      // The row exists but the bytes did not arrive. Take the row back out —
      // a document whose file is missing is worse than no document.
      if (createdId)
        await apiFetch(`/api/documents/${createdId}`, { method: "DELETE" }).catch(
          () => {}
        );
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {supersedes ? (
        <div className="rounded-2xl bg-blue-50 p-3.5 text-[0.8125rem] leading-relaxed text-blue-900 ring-1 ring-inset ring-blue-600/15">
          This becomes <strong>version {supersedes.version_no + 1}</strong> of
          &ldquo;{supersedes.title}&rdquo;. The current version stays readable —
          it is marked superseded, not deleted.
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="doc-file">
          File <span className="text-red-500">*</span>
        </label>
        <input
          ref={fileInput}
          id="doc-file"
          type="file"
          className="sr-only"
          // `capture` is deliberately absent: on a phone this opens the
          // chooser, which offers the camera AND the photo library. Forcing
          // the camera would make it impossible to add a photo taken earlier —
          // and `taken_at` exists precisely because that is normal.
          accept="image/*,application/pdf,.doc,.docx,.txt"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className={`input flex items-center gap-3 text-left ${
            errors.file ? "input-invalid" : ""
          }`}
        >
          <Icon name={file ? "check" : "upload"} size={18} className="text-gray-400" />
          <span className="min-w-0 flex-1 truncate">
            {file ? (
              <>
                <span className="text-gray-900">{file.name}</span>
                <span className="ml-1.5 text-xs text-gray-500">
                  {formatBytes(file.size)}
                </span>
              </>
            ) : (
              <span className="text-gray-400">Choose a photo, PDF or document</span>
            )}
          </span>
        </button>
        {errors.file && <p className="field-error">{errors.file}</p>}
      </div>

      <div>
        <label className="label" htmlFor="doc-type">
          Type <span className="text-red-500">*</span>
        </label>
        <Select
          id="doc-type"
          title="Document type"
          value={form.doc_type}
          onChange={(v) => set("doc_type", v)}
          options={DOC_TYPES.map((t) => ({
            value: t,
            label: DOC_TYPE_LABELS[t],
          }))}
          invalid={Boolean(errors.doc_type)}
        />
        {errors.doc_type && <p className="field-error">{errors.doc_type}</p>}
      </div>

      <div>
        <label className="label" htmlFor="doc-title">
          Title <span className="text-red-500">*</span>
        </label>
        <input
          id="doc-title"
          className={`input ${errors.title ? "input-invalid" : ""}`}
          maxLength={200}
          value={form.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder={isPhoto ? "Back bedroom, first fix" : "Planning decision notice"}
        />
        {errors.title && <p className="field-error">{errors.title}</p>}
      </div>

      {/* Photos are filed by WHEN and WHERE; everything else by reference and
          dates. Showing both sets at once would make a nine-field form for a
          picture of a wall. */}
      {isPhoto ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="doc-taken">
              Taken on
            </label>
            <DatePicker
              id="doc-taken"
              title="When was it taken"
              placeholder="Not recorded"
              value={form.taken_at}
              onChange={(v) => set("taken_at", v)}
            />
            <p className="hint">
              Not the upload date. A photo taken in February belongs in
              February on the timeline; without this it sorts to the end.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="doc-room">
              Room
            </label>
            <input
              id="doc-room"
              className="input"
              value={form.location_room ?? ""}
              onChange={(e) => set("location_room", e.target.value)}
              placeholder="Back bedroom"
            />
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="label" htmlFor="doc-reference">
              Reference
            </label>
            <input
              id="doc-reference"
              className="input"
              value={form.reference ?? ""}
              onChange={(e) => set("reference", e.target.value)}
              placeholder="Planning ref, certificate number, drawing no."
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="doc-issued">
                Issued
              </label>
              <DatePicker
                id="doc-issued"
                title="Issued on"
                placeholder="Not recorded"
                value={form.issued_on}
                onChange={(v) => set("issued_on", v)}
              />
            </div>
            <div>
              <label className="label" htmlFor="doc-expires">
                Expires
              </label>
              <DatePicker
                id="doc-expires"
                title="Expires on"
                placeholder="Never"
                value={form.expires_on}
                onChange={(v) => set("expires_on", v)}
              />
              {errors.expires_on && (
                <p className="field-error">{errors.expires_on}</p>
              )}
            </div>
          </div>
        </>
      )}

      {phases.length > 0 ? (
        <div>
          <label className="label" htmlFor="doc-phase">
            Phase
          </label>
          <Select
            id="doc-phase"
            title="Phase"
            placeholder="Not tied to a phase"
            clearable
            value={form.phase_id ?? ""}
            onChange={(v) => set("phase_id", v)}
            options={phases.map((p) => ({ value: p.id, label: p.name }))}
          />
        </div>
      ) : null}

      {tasks.length > 0 ? (
        <div>
          <label className="label" htmlFor="doc-task">
            Task
          </label>
          <Select
            id="doc-task"
            title="Task"
            placeholder="Not tied to a task"
            clearable
            value={form.task_id ?? ""}
            onChange={(v) => set("task_id", v)}
            options={tasks.map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
      ) : null}

      {contacts.length > 0 && !isPhoto ? (
        <div>
          <label className="label" htmlFor="doc-contact">
            Belongs to
          </label>
          <Select
            id="doc-contact"
            title="Person"
            placeholder="Nobody in particular"
            clearable
            value={form.contact_id ?? ""}
            onChange={(v) => set("contact_id", v)}
            options={contacts.map((c) => ({ value: c.id, label: c.name }))}
          />
          <p className="hint">
            For a certificate that is a person&apos;s rather than the
            job&apos;s — a Gas Safe card, an insurance policy.
          </p>
        </div>
      ) : null}

      <label className="flex items-start gap-3 rounded-2xl bg-gray-50 p-3.5">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300"
          checked={!form.project_scoped}
          onChange={(e) => set("project_scoped", !e.target.checked)}
        />
        <span className="text-[0.8125rem] leading-relaxed text-gray-700">
          <span className="font-semibold text-gray-900">
            Not specific to this project
          </span>
          <br />
          For something that belongs to the business rather than the job — a
          company insurance certificate, say. It then shows on every
          project&apos;s document list.
        </span>
      </label>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {saving ? "Uploading…" : supersedes ? "Add version" : "Add document"}
        </button>
      </div>
    </form>
  );
}
