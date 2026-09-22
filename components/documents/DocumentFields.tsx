"use client";

import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@/types";

/**
 * The metadata half of a document — everything except the file itself.
 *
 * Shared by DocumentUpload (add, or add a new version) and DocumentEdit (fix
 * what was typed). It is one component rather than two copies because the two
 * screens have to offer the same fields: a title typo and a missing
 * `expires_on` are the two things the edit path exists for, and a form that
 * quietly lacked a field would send people back to deleting and re-uploading,
 * which is exactly what breaks a version chain.
 */
export interface DocumentFormState {
  title: string;
  doc_type: DocType;
  reference: string;
  issued_on: string;
  expires_on: string;
  taken_at: string;
  location_room: string;
  phase_id: string;
  task_id: string;
  contact_id: string;
  /** Not editable anywhere yet, but carried so an edit cannot wipe it. */
  notes: string;
  /**
   * Scoped to the project unless it genuinely belongs to the business — a
   * company insurance certificate is not one job's, and one that is not
   * scoped shows on every project's list.
   */
  project_scoped: boolean;
}

export default function DocumentFields({
  form,
  set,
  errors,
  phases = [],
  tasks = [],
  contacts = [],
}: {
  form: DocumentFormState;
  set: (field: keyof DocumentFormState, value: string | boolean) => void;
  errors: Record<string, string>;
  phases?: { id: string; name: string }[];
  tasks?: { id: string; name: string }[];
  contacts?: { id: string; name: string }[];
}) {
  const isPhoto = form.doc_type === "photo";

  return (
    <>
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
            {errors.taken_at && <p className="field-error">{errors.taken_at}</p>}
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
              {errors.issued_on && (
                <p className="field-error">{errors.issued_on}</p>
              )}
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
    </>
  );
}
