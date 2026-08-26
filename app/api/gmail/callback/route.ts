// GET /api/gmail/callback — Google sends the user back here after consent.
//
// Verifies the state nonce, swaps the one-time code for a refresh token,
// stores it against the user, and then registers the Gmail watch so push
// notifications start immediately rather than at the next daily renew.
//
// The watch is best-effort and deliberately cannot fail the connection — see
// registerWatch() at the bottom of this file.
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/api";
import {
  exchangeCode,
  getAccessToken,
  GmailAuthError,
  OAUTH_STATE_COOKIE,
} from "@/lib/gmail/auth";
import { watch } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

// Always land back on /settings — the Gmail section there is where the result
// is visible — and always clear the state cookie, success or failure.
function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings", request.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user, supabase } = auth;

  const params = request.nextUrl.searchParams;

  // The user pressed Cancel on Google's consent screen, or Google refused.
  const googleError = params.get("error");
  if (googleError) {
    return back(request, { gmail_error: `Google returned: ${googleError}` });
  }

  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

  // A missing or mismatched nonce means this callback did not come from a
  // consent flow this browser started. Refuse it — do not exchange the code.
  if (!expected || !state || state !== expected) {
    return back(request, {
      gmail_error: "That sign-in link was not one this browser started. Try again.",
    });
  }
  if (!code) {
    return back(request, { gmail_error: "Google sent no authorisation code." });
  }

  let credential;
  try {
    credential = await exchangeCode(code);
  } catch (e) {
    if (e instanceof GmailAuthError) {
      return back(request, {
        gmail_error: `Google would not issue a lasting credential: ${e.message}`,
      });
    }
    console.error("[gmail callback] exchange failed:", e);
    return back(request, {
      gmail_error: "Could not complete the connection to Google. Try again.",
    });
  }

  // Reconnecting the same mailbox replaces the credential in place. The
  // unique (user_id, email_address) index from 0013 is what makes this an
  // update rather than a second, competing account row.
  //
  // status is reset to 'active' and error cleared: a reconnect is precisely
  // the fix for 'needs_reauth', so it must not stay stuck there. No
  // .eq("user_id", …) anywhere — RLS scopes this (R3).
  const { data: accountRow, error: dbError } = await supabase
    .from("gmail_accounts")
    .upsert(
      {
        user_id: user.id,
        email_address: credential.emailAddress,
        refresh_token: credential.refreshToken,
        status: "active",
        error: null,
      },
      { onConflict: "user_id,email_address" }
    )
    .select("id, last_history_id")
    .single();

  if (dbError) {
    console.error("[gmail callback] upsert failed:", dbError.message);
    return back(request, {
      gmail_error: `Connected to Google, but could not save it: ${dbError.message}`,
    });
  }

  // Register the watch now, not at 03:17 tomorrow.
  //
  // This route used to stop at the upsert and leave the watch to the daily
  // renew cron. That meant a freshly connected mailbox had no Pub/Sub
  // subscription — and so no push notifications, and so nothing to drain —
  // until the next morning, which reads as "I connected Gmail and nothing
  // happened".
  //
  // Deliberately best-effort. The credential is already saved and is the
  // valuable part; a watch that could not be registered is recoverable with
  // one button on /settings, whereas losing the credential means going round
  // the whole consent flow again. So every failure here is caught, and the
  // redirect still succeeds — it just carries watch=failed so the settings
  // screen can say so rather than looking fine while nothing arrives.
  const watchOutcome = await registerWatch(
    supabase,
    accountRow.id as string,
    (accountRow.last_history_id as string | null) ?? null,
    credential.refreshToken
  );

  return back(request, {
    gmail_connected: credential.emailAddress,
    ...(watchOutcome.ok ? {} : { watch: "failed", watch_error: watchOutcome.detail }),
  });
}

/**
 * The same call the renew route makes, with the same cursor rule: the baseline
 * historyId is written on the FIRST registration only, so reconnecting a
 * mailbox never rewinds or skips a cursor the drain is part-way through.
 */
async function registerWatch(
  supabase: SupabaseClient,
  accountId: string,
  lastHistoryId: string | null,
  refreshToken: string
): Promise<{ ok: true } | { ok: false; detail: string }> {
  try {
    const topicName = process.env.GMAIL_PUBSUB_TOPIC;
    if (!topicName) throw new Error("GMAIL_PUBSUB_TOPIC is not set.");

    const labelId = process.env.GMAIL_INVOICES_LABEL_ID;
    if (!labelId) throw new Error("GMAIL_INVOICES_LABEL_ID is not set.");

    const accessToken = await getAccessToken(refreshToken);
    const response = await watch(accessToken, { topicName, labelIds: [labelId] });

    const patch: Record<string, unknown> = {
      watch_expiration: new Date(Number(response.expiration)).toISOString(),
      watch_label_id: labelId,
      error: null,
    };
    if (lastHistoryId === null) patch.last_history_id = response.historyId;

    // No .eq("user_id", …) — this is the session client, so RLS scopes it (R3).
    const { error: writeError } = await supabase
      .from("gmail_accounts")
      .update(patch)
      .eq("id", accountId);
    if (writeError) throw new Error(writeError.message);

    return { ok: true };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error.";
    console.error("[gmail callback] watch failed:", detail);
    // Recorded on the account too, so the failure survives the redirect and is
    // still visible on a later visit to /settings.
    await supabase
      .from("gmail_accounts")
      .update({ error: `Could not register the Gmail watch: ${detail}` })
      .eq("id", accountId);
    return { ok: false, detail };
  }
}
