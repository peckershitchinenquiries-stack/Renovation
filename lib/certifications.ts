/**
 * Expiry — the one useful thing a certificate register does.
 *
 * A phone number for the plasterer saves you a minute. Public liability that
 * lapsed in March, on a job that is still running, is a real problem, and the
 * only reason nobody notices is that nobody looks. So the state of every
 * certificate is derived here, on every read, and surfaced somewhere a person
 * actually is — the Dashboard — rather than on a detail page they visit twice
 * a year.
 *
 * Nothing here is stored. A stored `expired` flag is wrong the morning after
 * it is written, which is the worst possible failure for a compliance date:
 * silently, and in the reassuring direction.
 *
 * This module is shared with lib/documents.ts on purpose. A warranty and a
 * Gas Safe certificate expire in exactly the same way, and two functions that
 * both answer "is this still valid?" would eventually answer differently.
 */

import type {
  CertificationView,
  ContactCertification,
  ExpiryState,
} from "@/types";

/**
 * How long before an expiry is worth warning about.
 *
 * Thirty days is not arbitrary: it is roughly how long it takes to get a
 * renewed policy or certificate issued and sent on, so a warning any later
 * than this is a warning you cannot act on.
 */
export const EXPIRY_WARNING_DAYS = 30;

/** Today, as an ISO date, in the same UTC-day terms the rest of the app uses. */
export const todayISO = (): string => new Date().toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY_MS);
}

/**
 * Is this still any good?
 *
 * `unknown` is a real answer and deliberately not folded into `valid`: a
 * certificate with no expiry date on file has not been checked, and calling
 * that "valid" is exactly the comfortable lie this function exists to avoid.
 */
export function expiryStatus(
  expires_on: string | null | undefined,
  today: string = todayISO(),
  warningDays: number = EXPIRY_WARNING_DAYS
): { state: ExpiryState; days_remaining: number | null } {
  if (!expires_on) return { state: "unknown", days_remaining: null };
  const days = daysBetween(today, expires_on);
  if (days < 0) return { state: "expired", days_remaining: days };
  if (days <= warningDays) return { state: "expiring_soon", days_remaining: days };
  return { state: "valid", days_remaining: days };
}

/** Worst state in a set — what a contact's row chip shows. */
const SEVERITY: Record<ExpiryState, number> = {
  expired: 3,
  expiring_soon: 2,
  unknown: 1,
  valid: 0,
};

export function worstState(states: ExpiryState[]): ExpiryState {
  let worst: ExpiryState = "valid";
  for (const s of states) if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  return worst;
}

/** Attach the derived state to a set of certificates, soonest expiry first. */
export function certificationViews(
  certifications: ContactCertification[],
  contactNames: Map<string, string>,
  today: string = todayISO()
): CertificationView[] {
  return certifications
    .map((cert) => {
      const { state, days_remaining } = expiryStatus(cert.expires_on, today);
      return {
        ...cert,
        state,
        days_remaining,
        contact_name: contactNames.get(cert.contact_id) ?? "Unknown",
      };
    })
    .sort((a, b) => {
      // Anything with a date comes before anything without one: a certificate
      // nobody has dated cannot be the most urgent thing on the list, but it
      // must not be invisible either.
      if (!a.expires_on && !b.expires_on) return a.kind.localeCompare(b.kind);
      if (!a.expires_on) return 1;
      if (!b.expires_on) return -1;
      return a.expires_on.localeCompare(b.expires_on);
    });
}

/** One line for the Dashboard: "2 certificates expire within 30 days". */
export function expirySentence(views: CertificationView[]): string | null {
  const expired = views.filter((v) => v.state === "expired").length;
  const soon = views.filter((v) => v.state === "expiring_soon").length;
  if (expired === 0 && soon === 0) return null;

  const parts: string[] = [];
  if (expired > 0)
    parts.push(
      `${expired} ${expired === 1 ? "certificate has" : "certificates have"} expired`
    );
  if (soon > 0)
    parts.push(
      `${soon} ${soon === 1 ? "expires" : "expire"} within ${EXPIRY_WARNING_DAYS} days`
    );
  return `${parts.join(" · ")}.`;
}

/** The tone a chip or badge should use for a state. */
export function expiryTone(
  state: ExpiryState
): "good" | "warn" | "bad" | "neutral" {
  if (state === "expired") return "bad";
  if (state === "expiring_soon") return "warn";
  if (state === "unknown") return "neutral";
  return "good";
}

export function expiryLabel(state: ExpiryState, days: number | null): string {
  if (state === "expired")
    return days === null ? "Expired" : `Expired ${Math.abs(days)}d ago`;
  if (state === "expiring_soon") return `Expires in ${days}d`;
  if (state === "unknown") return "No expiry on file";
  return "Valid";
}
