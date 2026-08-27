// The guard on the two cron-invoked routes.
//
// /api/gmail/drain and /api/gmail/watch/renew run without a session — there is
// no logged-in user on a scheduled invocation — so requireUser() cannot be
// what protects them. Both use createServiceClient(), which bypasses RLS
// entirely, so an unguarded route would be a remote "read and write anything"
// endpoint. This is the whole of the protection.
//
// Both callers send `Authorization: Bearer $CRON_SECRET`. /api/gmail/watch/renew
// is still a Vercel Cron entry in vercel.json, and Vercel adds that header by
// itself once CRON_SECRET is set in the project's environment variables.
// /api/gmail/drain is called by cron-job.org instead — Hobby will not accept a
// five-minute cron — and there the header is configured by hand on the job.
//
// That means CRON_SECRET is now also held by a third party. Rotating it is a
// two-place edit: the Vercel environment variable *and* the cron-job.org job's
// header. Change one without the other and the drain answers 401 on every run.

import { timingSafeEqual } from "node:crypto";

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * True when the request carries the cron secret.
 *
 * Fails closed: if CRON_SECRET is unset, *nothing* is authorised, rather than
 * every request being. An unset secret on a deployed app would otherwise make
 * the drain public.
 */
export function isCronRequest(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  return secretsMatch(header.slice(prefix.length), expected);
}
