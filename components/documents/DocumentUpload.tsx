"use client";

import { useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateDocument, hasErrors } from "@/lib/validation";
import { Spinner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import {
  DOCUMENT_FILE_ACCEPT,
  documentMimeType,
  formatBytes,
} from "@/lib/documents";
import DocumentFields, { type DocumentFormState } from "./DocumentFields";
import type { DocType, ProjectDocument } from "@/types";

/**
 * Add a document, or a new version of one (migration 0021).
 *
 * The file goes STRAIGHT to Supabase Storage with a signed upload URL, never
 * through the Route Handler — Vercel caps serverless request bodies at 4.5MB
 * and a phone photo of a wall is comfortably bigger. This is the same
 * two-step the invoice upload already uses (about.md §8.2), but in the other
 * order, and the order is the point:
 *
 *   1. POST the metadata → get a signed URL back, and NO row yet
 *   2. PUT the bytes at that URL
 *   3. POST the metadata again → the server looks in the bucket, finds the
 *      object, and only then creates the row
 *
 * It used to be row-then-bytes, with the browser deleting the row again if the
 * PUT threw. That cleanup only runs while the browser is still alive: close
 * the tab on a slow phone upload and the row survived with no file behind it,
 * showed in the list, and failed every time anybody opened it. Abandoning an
 * upload now costs an unreferenced object in a private bucket — invisible —
 * instead of a document on screen that cannot be opened.
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
  const [form, setForm] = useState<DocumentFormState>({
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
    project_scoped: supersedes ? supersedes.project_id !== null : true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: keyof DocumentFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  function chooseFile(next: File | null) {
    setFile(next);
    if (!next) return;

    // The type is settled HERE, not at submit time, so an unsupported file is
    // refused while the person is still looking at the picker rather than
    // after they have filled the rest of the form in. `file.type` is empty
    // surprisingly often — on some iOS versions it is empty for HEIC, which is
    // precisely the case this store has to handle — so the filename extension
    // is the fallback. It can only ever produce an accepted type.
    if (!documentMimeType(next)) {
      setFile(null);
      setErrors((e) => ({
        ...e,
        file: `"${next.name}" is not a kind of file this store takes. Use a photo, a PDF, a Word file or a text file.`,
      }));
      return;
    }
    setErrors((e) => ({ ...e, file: "" }));

    // Fill the title from the filename the first time, minus its extension.
    // A prefilled title somebody can correct beats an empty required field.
    if (!form.title.trim())
      set("title", next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setErrors({ file: "Choose a file" });
      return;
    }
    const mimeType = documentMimeType(file);
    if (!mimeType) {
      setErrors({ file: "That kind of file cannot be added" });
      return;
    }

    const payload = {
      ...form,
      project_id: form.project_scoped ? projectId : null,
      snag_id: snagId ?? null,
      supersedes_id: supersedes?.id ?? null,
      filename: file.name,
      mime_type: mimeType,
      file_size: file.size,
    };

    const v = validateDocument(payload);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      const { upload_url, storage_path } = await apiFetch<{
        upload_url: string;
        storage_path: string;
      }>("/api/documents/upload-url", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const put = await fetch(upload_url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file,
      });
      if (!put.ok) throw new Error(`The file did not upload (${put.status})`);

      // Only now does a row exist — and the server checks the object is really
      // in the bucket before it makes one. Nothing to clean up if this never
      // runs: an orphaned object in a private bucket is invisible, where an
      // orphaned row is a document that fails every time it is opened.
      await apiFetch<ProjectDocument>("/api/documents", {
        method: "POST",
        body: JSON.stringify({ ...payload, storage_path }),
      });

      toast(supersedes ? "New version added" : "Document added", "success");
      onSaved();
    } catch (err) {
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
          //
          // The list is the SAME list the server accepts and the same one
          // migration 0025 puts on the bucket. It used to be `image/*`, which
          // offered GIFs, BMPs and TIFFs the server then refused with a 415
          // after the whole form had been filled in.
          accept={DOCUMENT_FILE_ACCEPT}
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

      <DocumentFields
        form={form}
        set={set}
        errors={errors}
        phases={phases}
        tasks={tasks}
        contacts={contacts}
      />

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
