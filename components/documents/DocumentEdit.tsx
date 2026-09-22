"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateDocument, hasErrors } from "@/lib/validation";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import DocumentFields, { type DocumentFormState } from "./DocumentFields";
import type { ProjectDocument } from "@/types";

/**
 * Fix a document's details (migration 0021).
 *
 * `PATCH /api/documents/[id]` has existed since the documents feature shipped
 * and nothing called it, so a typo'd title, a wrong type or a certificate
 * added without its expiry date could only be corrected by deleting the
 * document and uploading it again — which breaks the version chain, because
 * `version_no` and `supersedes_id` are set at upload time and a re-upload
 * starts a new chain at v1.
 *
 * The file is deliberately NOT editable here. A new file is a new VERSION,
 * which is what keeps rev B readable when rev C arrives; swapping the bytes
 * under an unchanged version number would make the whole chain untrustworthy.
 * "Add a new version" is the button next to this one.
 *
 * It sends the COMPLETE object, every field, not just the ones that were
 * touched. The route merges as well — belt and braces, and for a reason: the
 * payload builder writes every column on every call, so a partial body would
 * null what it left out, and a nulled `project_id` does not error anywhere. It
 * quietly makes the document global, and it then appears on every project's
 * list.
 */
export default function DocumentEdit({
  document,
  projectId,
  phases = [],
  tasks = [],
  contacts = [],
  onSaved,
  onCancel,
}: {
  document: ProjectDocument;
  /**
   * The project whose list this was opened from. A document with no project is
   * shown on every project's list, so ticking it back to "this project" has to
   * mean the one the reader is looking at — the row itself no longer says.
   */
  projectId: string;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<DocumentFormState>({
    title: document.title ?? "",
    doc_type: document.doc_type,
    reference: document.reference ?? "",
    issued_on: document.issued_on ?? "",
    expires_on: document.expires_on ?? "",
    taken_at: document.taken_at ?? "",
    location_room: document.location_room ?? "",
    phase_id: document.phase_id ?? "",
    task_id: document.task_id ?? "",
    contact_id: document.contact_id ?? "",
    // Not shown as a field, but carried through so saving cannot wipe it.
    notes: document.notes ?? "",
    project_scoped: document.project_id !== null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: keyof DocumentFormState, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      ...form,
      // Un-ticking "not specific to this project" puts it back on the project
      // whose list it was opened from — a project-less document has no other
      // answer to give.
      project_id: form.project_scoped
        ? document.project_id ?? projectId
        : null,
      snag_id: document.snag_id,
    };

    const v = validateDocument(payload);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("Document updated", "success");
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      toast(err instanceof Error ? err.message : "Could not save", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DocumentFields
        form={form}
        set={set}
        errors={errors}
        phases={phases}
        tasks={tasks}
        contacts={contacts}
      />

      <p className="hint">
        The file itself cannot be changed here — a new file is a new version,
        so the one this replaces stays readable. Use &ldquo;Add a new
        version&rdquo; for that.
      </p>

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 pb-safe backdrop-blur-xl sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-2 sm:pt-0 sm:backdrop-blur-none">
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary flex-1">
          {saving ? <Spinner /> : null}
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
