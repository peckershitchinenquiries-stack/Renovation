/**
 * Coercion for the Track B write paths (migrations 0020–0024).
 *
 * Same job as `buildTaskPayload` in lib/scheduleWrite.ts: form fields arrive as
 * strings, the numbers and the nulls are worked out in exactly one place, and
 * the client and the server therefore agree on what a blank field means.
 *
 * The rule, inherited: a blank string from a form is CLEARED, not zero and not
 * unchanged. That distinction is why `retention_pct` can say "no retention"
 * rather than "0% held", and why a day rate somebody deleted becomes "no rate
 * on file" — which the Gantt's cost chip then refuses to guess from — instead
 * of "£0 a day", which would price every delay at nothing.
 */

import type {
  ActivityInput,
  CertificationInput,
  ContactInput,
  DocumentInput,
  SnagInput,
  VariationInput,
} from "@/types";

const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const numberOrNull = (v: unknown): number | null => {
  const s = text(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v: unknown): number | null => {
  const n = numberOrNull(v);
  return n === null ? null : Math.round(n);
};

// ---- people (0020) ----

export function buildContactPayload(body: ContactInput): Record<string, unknown> {
  return {
    name: String(body.name ?? "").trim(),
    company: text(body.company),
    // Blank entries dropped and duplicates removed: a trades array with an
    // empty string in it turns into a nameless chip on every screen.
    trades: [
      ...new Set(
        (body.trades ?? [])
          .map((t) => String(t).trim())
          .filter((t) => t !== "")
      ),
    ],
    phone: text(body.phone),
    email: text(body.email)?.toLowerCase() ?? null,
    address: text(body.address),
    day_rate: numberOrNull(body.day_rate),
    hourly_rate: numberOrNull(body.hourly_rate),
    supplier_id: text(body.supplier_id),
    status: body.status ?? "active",
    notes: text(body.notes),
  };
}

export function buildCertificationPayload(
  body: CertificationInput
): Record<string, unknown> {
  return {
    kind: body.kind,
    reference: text(body.reference),
    issued_on: text(body.issued_on),
    // Nullable on purpose. A certificate with no expiry date on file reads as
    // 'unknown' rather than 'valid' (lib/certifications.ts) — "we have not
    // checked" is a different answer from "we checked and it is fine".
    expires_on: text(body.expires_on),
    document_id: text(body.document_id),
    notes: text(body.notes),
  };
}

// ---- documents (0021) ----

export function buildDocumentPayload(
  body: DocumentInput
): Record<string, unknown> {
  return {
    project_id: text(body.project_id),
    doc_type: body.doc_type,
    title: String(body.title ?? "").trim(),
    issued_on: text(body.issued_on),
    expires_on: text(body.expires_on),
    reference: text(body.reference),
    phase_id: text(body.phase_id),
    task_id: text(body.task_id),
    contact_id: text(body.contact_id),
    snag_id: text(body.snag_id),
    taken_at: text(body.taken_at),
    location_room: text(body.location_room),
    notes: text(body.notes),
    // NOT here: `is_current`, `version_no` and `supersedes_id`. The first is
    // maintained by a trigger (0021) and must never be written by hand; the
    // other two are set by the version route, which is the only thing that
    // knows what it is superseding.
  };
}

// ---- communication (0022) ----

export function buildActivityPayload(
  body: ActivityInput
): Record<string, unknown> {
  const when = text(body.occurred_at);
  return {
    // The form sends a date; the column is a timestamptz. Midday UTC rather
    // than midnight, so a log entry cannot slide onto the previous day when it
    // is read back in a British summer.
    occurred_at: when ? `${when}T12:00:00Z` : new Date().toISOString(),
    kind: body.kind,
    summary: String(body.summary ?? "").trim(),
    detail: text(body.detail),
    contact_id: text(body.contact_id),
    task_id: text(body.task_id),
    phase_id: text(body.phase_id),
  };
}

export function buildSnagPayload(body: SnagInput): Record<string, unknown> {
  return {
    title: String(body.title ?? "").trim(),
    description: text(body.description),
    location_room: text(body.location_room),
    phase_id: text(body.phase_id),
    task_id: text(body.task_id),
    contact_id: text(body.contact_id),
    status: body.status,
    severity: body.severity,
    raised_on: text(body.raised_on) ?? new Date().toISOString().slice(0, 10),
    fixed_on: text(body.fixed_on),
    verified_on: text(body.verified_on),
  };
}

// ---- variations (0024) ----

export function buildVariationPayload(
  body: VariationInput
): Record<string, unknown> {
  const status = body.status;
  return {
    ref: text(body.ref),
    title: String(body.title ?? "").trim(),
    description: text(body.description),
    requested_by: text(body.requested_by),
    raised_on: text(body.raised_on) ?? new Date().toISOString().slice(0, 10),
    status,
    // Mirrors variations_approved_needs_status: an approval date survives only
    // while the variation is approved. Clearing it when the status changes
    // back is what stops the CHECK rejecting an otherwise sensible edit.
    approved_on: status === "approved" ? text(body.approved_on) : null,
    // Both SIGNED — a variation can be an omission — so nothing here floors
    // them at zero.
    cost_impact: numberOrNull(body.cost_impact),
    days_impact: intOrNull(body.days_impact),
    task_id: text(body.task_id),
    phase_id: text(body.phase_id),
  };
}
