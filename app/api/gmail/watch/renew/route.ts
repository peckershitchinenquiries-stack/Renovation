// POST /api/gmail/watch/renew — keep every connected mailbox's Gmail watch alive.
//
// A Gmail watch expires after seven days, always, whatever else happens. This
// runs daily (vercel.json) so a missed day is a non-event rather than an
// outage: six more chances to renew before anything stops arriving.
//
// Cron-invoked, so there is no session and requireUser() is not what protects
// it — isCronRequest() is. See lib/gmail/cron.ts.
//
// **Service-role, no RLS (R3 exception).** This route reads and writes
// gmail_accounts rows belonging to whichever user owns them, because a cron
// request has no auth.uid() for the policies to compare against. Every write
// below is keyed on the account's own id, which carries its user_id with it.
// See about.md §8.4.

import { createServiceClient } from "@/lib/supabase/server";
import { json, error } from "@/lib/api";
import { getAccessToken, GmailAuthError } from "@/lib/gmail/auth";
import { watch } from "@/lib/gmail/client";
import { isCronRequest } from "@/lib/gmail/cron";
import type { GmailAccount } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RenewResult {
  email: string;
  outcome: "renewed" | "needs_reauth" | "error" | "skipped";
  detail: string;
}

export async function POST(req: Request) {
  if (!isCronRequest(req)) return error("Not authorised", 401);

  const topicName = process.env.GMAIL_PUBSUB_TOPIC;
  if (!topicName)
    return error("GMAIL_PUBSUB_TOPIC is not set — cannot register a watch.", 500);

  // Falls back to the configured invoices label when the account has not
  // recorded one yet. Watching *everything* would work and would also mean
  // every newsletter costs a notification, a row and a history walk — the
  // label filter is applied at Gmail's end precisely so it does not.
  const defaultLabelId = process.env.GMAIL_INVOICES_LABEL_ID ?? null;

  // Service-role client: no logged-in session on a cron request, so RLS has no
  // auth.uid() to scope by (R3 exception — see the header comment).
  const supabase = createServiceClient();

  const { data: rows, error: readError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("status", "active");
  if (readError) return error(readError.message, 500);

  const accounts = (rows ?? []) as GmailAccount[];
  const results: RenewResult[] = [];

  for (const account of accounts) {
    const labelId = account.watch_label_id ?? defaultLabelId;

    if (!labelId) {
      results.push({
        email: account.email_address,
        outcome: "skipped",
        detail:
          "No watch label: set GMAIL_INVOICES_LABEL_ID, or record one on the account.",
      });
      continue;
    }

    try {
      const accessToken = await getAccessToken(account.refresh_token);
      const response = await watch(accessToken, {
        topicName,
        labelIds: [labelId],
      });

      // The cursor is written on the FIRST renew only. `watch` returns the
      // mailbox's history point right now, and later runs must not overwrite a
      // cursor the drain is part-way through — that would silently skip every
      // message that arrived between the drain's position and this moment.
      const patch: Record<string, unknown> = {
        watch_expiration: new Date(Number(response.expiration)).toISOString(),
        watch_label_id: labelId,
        error: null,
      };
      if (account.last_history_id === null) {
        patch.last_history_id = response.historyId;
      }

      const { error: writeError } = await supabase
        .from("gmail_accounts")
        .update(patch)
        .eq("id", account.id);
      if (writeError) throw new Error(writeError.message);

      results.push({
        email: account.email_address,
        outcome: "renewed",
        detail:
          account.last_history_id === null
            ? `Baseline set at historyId ${response.historyId}.`
            : `Cursor left at ${account.last_history_id}.`,
      });
    } catch (e) {
      // A dead refresh token is the routine failure while the Google consent
      // screen is in Testing mode — test-user refresh tokens expire after seven
      // days, every time. It needs a Reconnect, not a retry, so the account is
      // parked and the loop carries on with the next mailbox.
      if (e instanceof GmailAuthError) {
        await supabase
          .from("gmail_accounts")
          .update({
            status: "needs_reauth",
            error: `Google would not renew the credential: ${e.message}`,
          })
          .eq("id", account.id);
        results.push({
          email: account.email_address,
          outcome: "needs_reauth",
          detail: e.message,
        });
        continue;
      }

      const detail = e instanceof Error ? e.message : "Unknown error.";
      // Anything else is transient. Record it where the settings screen can
      // show it, leave the account 'active', and try again tomorrow.
      await supabase
        .from("gmail_accounts")
        .update({ error: `Watch renewal failed: ${detail}` })
        .eq("id", account.id);
      results.push({
        email: account.email_address,
        outcome: "error",
        detail,
      });
    }
  }

  return json({ accounts: accounts.length, results });
}
