// GET /api/gmail/callback — Google sends the user back here after consent.
//
// Verifies the state nonce, swaps the one-time code for a refresh token, and
// stores it against the user. Nothing is fetched from the mailbox: phase 2
// registers the watch and fills in last_history_id / watch_expiration, which
// this route deliberately leaves null.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api";
import {
  exchangeCode,
  GmailAuthError,
  OAUTH_STATE_COOKIE,
} from "@/lib/gmail/auth";

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
  const { error: dbError } = await supabase.from("gmail_accounts").upsert(
    {
      user_id: user.id,
      email_address: credential.emailAddress,
      refresh_token: credential.refreshToken,
      status: "active",
      error: null,
    },
    { onConflict: "user_id,email_address" }
  );

  if (dbError) {
    console.error("[gmail callback] upsert failed:", dbError.message);
    return back(request, {
      gmail_error: `Connected to Google, but could not save it: ${dbError.message}`,
    });
  }

  return back(request, { gmail_connected: credential.emailAddress });
}
