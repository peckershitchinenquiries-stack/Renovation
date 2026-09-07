"use client";

import { useState } from "react";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { validateCertification, hasErrors } from "@/lib/validation";
import { Select } from "@/components/ui/Select";
import { DatePicker } from "@/components/ui/DatePicker";
import { Spinner } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toast";
import {
  CERTIFICATION_KINDS,
  type ContactCertification,
} from "@/types";

/**
 * One certificate against one person (migration 0020).
 *
 * The expiry date is the field that matters. Everything else is filing; the
 * expiry is what makes the app able to warn you 30 days before public
 * liability lapses on a job that is still running.
 *
 * It is nonetheless OPTIONAL, because a certificate you hold but have not
 * checked the date of is still worth recording — and it reads as "No expiry on
 * file", never as valid. "We have not checked" and "we checked and it is fine"
 * are different answers, and a register that conflates them is worse than no
 * register at all.
 */
export default function CertificationForm({
  contactId,
  certification,
  onSaved,
  onCancel,
}: {
  contactId: string;
  certification?: ContactCertification;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const toast = useToast();
  const editing = Boolean(certification);
  const [form, setForm] = useState({
    kind: certification?.kind ?? "Public liability",
    reference: certification?.reference ?? "",
    issued_on: certification?.issued_on ?? "",
    expires_on: certification?.expires_on ?? "",
    notes: certification?.notes ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateCertification(form);
    setErrors(v);
    if (hasErrors(v)) return;

    setSaving(true);
    try {
      await apiFetch(
        editing
          ? `/api/contacts/${contactId}/certifications/${certification!.id}`
          : `/api/contacts/${contactId}/certifications`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(form) }
      );
      toast(editing ? "Certificate updated" : "Certificate recorded", "success");
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
        <label className="label" htmlFor="cert-kind">
          Certificate <span className="text-red-500">*</span>
        </label>
        <Select
          id="cert-kind"
          title="What kind of certificate"
          value={form.kind}
          onChange={(v) => set("kind", v)}
          options={CERTIFICATION_KINDS.map((k) => ({ value: k, label: k }))}
          invalid={Boolean(errors.kind)}
        />
        {errors.kind && <p className="field-error">{errors.kind}</p>}
        <p className="hint">
          A fixed list on purpose: &ldquo;PL insurance&rdquo;, &ldquo;Public
          Liab.&rdquo; and &ldquo;public liability&rdquo; spread across three
          rows answer no question. Anything else is <strong>Other</strong>, with
          the name in the reference.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="cert-reference">
          Reference / policy number
        </label>
        <input
          id="cert-reference"
          className="input"
          value={form.reference ?? ""}
          onChange={(e) => set("reference", e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="cert-issued">
            Issued
          </label>
          <DatePicker
            id="cert-issued"
            title="Issued on"
            placeholder="Not recorded"
            value={form.issued_on}
            onChange={(v) => set("issued_on", v)}
          />
        </div>
        <div>
          <label className="label" htmlFor="cert-expires">
            Expires
          </label>
          <DatePicker
            id="cert-expires"
            title="Expires on"
            placeholder="Not recorded"
            value={form.expires_on}
            onChange={(v) => set("expires_on", v)}
          />
          {errors.expires_on && (
            <p className="field-error">{errors.expires_on}</p>
          )}
        </div>
      </div>
      <p className="hint -mt-2">
        With an expiry date the dashboard warns 30 days out. Without one this
        reads as <strong>no expiry on file</strong> — never as valid.
      </p>

      <div>
        <label className="label" htmlFor="cert-notes">
          Notes
        </label>
        <textarea
          id="cert-notes"
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
          {editing ? "Save changes" : "Record certificate"}
        </button>
      </div>
    </form>
  );
}
