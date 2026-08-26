// POST /api/gmail/push — the Pub/Sub push endpoint.
//
// This is the only URL in RenovaTrack reachable without a session. Anyone can
// POST to it, so it does two things and only two things: prove the caller is
// Google, and write the notification down.
//
// It does NOT read the mailbox. A Gmail notification carries only
// { emailAddress, historyId } — every actual message has to be fetched
// afterwards — and Pub/Sub's ack deadline is ten seconds. Walking history and
// downloading attachments will exceed that, and an un-acked message is
// redelivered, which under load becomes a redelivery storm against an endpoint
// that is already struggling. So the work is written to gmail_events and
// /api/gmail/drain does it on a five-minute cron. The row is also the audit
// trail: what arrived, when, and what happened to it.
//
// The status code is part of the contract, not decoration:
//
//   200 — durably recorded, OR can never be processed no matter how often it
//         is re-sent (unknown mailbox, malformed body). Ack it and move on.
//   401 — the caller is not Google. Nothing is recorded.
//   5xx — a transient failure we genuinely want retried. Used sparingly: a
//         permanent 500 here makes Pub/Sub redeliver for up to seven days
//         before dead-lettering.
//
// **Service-role, no RLS (R3 exception).** There is no session on a
// machine-to-machine request, so auth.uid() is null and the policies would
// match nothing. user_id is taken from the gmail_accounts row and set
// explicitly on the insert. See about.md §8.4.
//
// This path is excluded from the middleware matcher — refreshing a Supabase
// session cookie for a caller that has none is pure waste.

import { timingSafeEqual } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { json, error } from "@/lib/api";
import { verifyPushToken, PushAuthError } from "@/lib/gmail/oidc";
import type { GmailAccount } from "@/types";

export const dynamic = "force-dynamic";

interface PushEnvelope {
  message?: {
    /** base64 JSON: { emailAddress, historyId } */
    data?: string;
    messageId?: string;
    message_id?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GmailNotification {
  emailAddress?: string;
  historyId?: string | number;
}

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  // ---- 1. the shared-secret query parameter ----------------------------
  // Belt and braces alongside the OIDC check below, and deliberately first: it
  // costs nothing, and it means a passing scanner never triggers a certificate
  // fetch. Configured on the Pub/Sub subscription's push URL.
  const pushSecret = process.env.GMAIL_PUSH_SECRET;
  if (!pushSecret) {
    console.error("[gmail push] GMAIL_PUSH_SECRET is not set — refusing everything.");
    return error("Not authorised", 401);
  }
  const given = new URL(req.url).searchParams.get("token");
  if (!secretMatches(given, pushSecret)) {
    return error("Not authorised", 401);
  }

  // ---- 2. the OIDC token ------------------------------------------------
  const audience = process.env.GMAIL_PUSH_AUDIENCE;
  const serviceAccountEmail = process.env.GMAIL_PUSH_SERVICE_ACCOUNT;
  if (!audience || !serviceAccountEmail) {
    console.error(
      "[gmail push] GMAIL_PUSH_AUDIENCE / GMAIL_PUSH_SERVICE_ACCOUNT are not set."
    );
    return error("Not authorised", 401);
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return error("Not authorised", 401);
  }

  try {
    await verifyPushToken(authHeader.slice("Bearer ".length), {
      audience,
      serviceAccountEmail,
    });
  } catch (e) {
    // Logged in full, answered with nothing: a caller that cannot authenticate
    // has no business learning which check it failed.
    console.error(
      "[gmail push] token rejected:",
      e instanceof PushAuthError ? e.message : e
    );
    return error("Not authorised", 401);
  }

  // ---- 3. the envelope --------------------------------------------------
  // From here on the caller is Google, so a malformed body is a bug rather
  // than an attack — and re-sending it would produce the same malformed body,
  // so it is acked rather than retried.
  const envelope = (await req.json().catch(() => null)) as PushEnvelope | null;
  const pubsubMessageId =
    envelope?.message?.messageId ?? envelope?.message?.message_id ?? null;
  const dataB64 = envelope?.message?.data;

  if (!pubsubMessageId || !dataB64) {
    console.error("[gmail push] envelope had no messageId or data — acked.");
    return json({ ok: true, ignored: "malformed envelope" });
  }

  let notification: GmailNotification;
  try {
    notification = JSON.parse(
      Buffer.from(dataB64, "base64").toString("utf8")
    ) as GmailNotification;
  } catch {
    console.error("[gmail push] message.data was not JSON — acked.");
    return json({ ok: true, ignored: "unreadable data" });
  }

  const emailAddress = notification.emailAddress?.trim();
  const historyId =
    notification.historyId === undefined || notification.historyId === null
      ? null
      : String(notification.historyId);

  if (!emailAddress || !historyId) {
    console.error("[gmail push] notification lacked emailAddress or historyId — acked.");
    return json({ ok: true, ignored: "incomplete notification" });
  }

  // ---- 4. record it -----------------------------------------------------
  // Service-role client: no session, so RLS has no auth.uid() to scope by
  // (R3 exception — see the header comment). user_id comes off the account row.
  const supabase = createServiceClient();

  // ilike, not eq: Google's notification and the address stored at connect
  // both come from Google, but email addresses are not case-sensitive and one
  // mismatch here would silently drop every notification for that mailbox.
  const { data: accountRow, error: lookupError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .ilike("email_address", emailAddress)
    .maybeSingle();

  if (lookupError) {
    // A database that is down is exactly the transient case Pub/Sub's retry is
    // for. This is the one path that asks to be re-sent.
    console.error("[gmail push] account lookup failed:", lookupError.message);
    return error("Could not record the notification", 503);
  }

  if (!accountRow) {
    // A mailbox nobody has connected. Re-sending will not make it connected,
    // so this is acked rather than retried for seven days.
    console.error(`[gmail push] no connected account for ${emailAddress} — acked.`);
    return json({ ok: true, ignored: "unknown mailbox" });
  }

  const account = accountRow as GmailAccount;

  // ignoreDuplicates is the whole reason 0013 put a unique index on
  // (user_id, pubsub_message_id): Pub/Sub delivery is at-least-once, and this
  // turns the second delivery of a notification into a no-op instead of a
  // second history walk.
  const { error: insertError } = await supabase.from("gmail_events").upsert(
    {
      user_id: account.user_id,
      account_id: account.id,
      pubsub_message_id: pubsubMessageId,
      history_id: historyId,
      status: "pending",
    },
    { onConflict: "user_id,pubsub_message_id", ignoreDuplicates: true }
  );

  if (insertError) {
    console.error("[gmail push] could not write the event:", insertError.message);
    return error("Could not record the notification", 503);
  }

  // Best-effort: the settings screen shows this so the owner can see the
  // connection is live. A failure here must not un-ack a recorded event.
  const { error: touchError } = await supabase
    .from("gmail_accounts")
    .update({ last_notification_at: new Date().toISOString() })
    .eq("id", account.id);
  if (touchError) {
    console.error("[gmail push] could not stamp last_notification_at:", touchError.message);
  }

  return json({ ok: true, recorded: pubsubMessageId });
}
