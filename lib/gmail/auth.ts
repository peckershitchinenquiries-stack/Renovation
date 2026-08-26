// Google OAuth credential plumbing for Gmail ingestion (migration 0013).
//
// Deliberately dependency-free: everything here is two POSTs and a GET against
// documented Google endpoints, which is less code than wiring up googleapis
// and far easier to see the whole of.
//
// The one rule that shapes this file: **access tokens are never stored.** Only
// the refresh token goes in `gmail_accounts.refresh_token`. Access tokens are
// minted on demand and held in memory for their lifetime; a restart simply
// mints another. There is therefore no stale-token path to reason about.
//
// This module is server-only: it is imported by Route Handlers alone, and none
// of these env vars may ever be prefixed NEXT_PUBLIC_ — the client secret
// would ship to the browser.

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

// readonly gets us the message and its attachments; modify is what phase 2
// needs to label a message as processed so a re-drain does not re-read it.
// The connect route writes this cookie and the callback checks it. It lives
// here rather than in either route because a Route Handler module may only
// export handlers and route config — Next's generated types reject anything
// else.
export const OAUTH_STATE_COOKIE = "gmail_oauth_state";

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

// Thrown when Google says the refresh token is no longer usable. The caller
// catches *this specific class* and sets the account to 'needs_reauth' —
// anything else is a transient failure and should be retried, not reauthed.
//
// This is the expected, routine failure while the Google Cloud consent screen
// is in Testing mode: refresh tokens issued to a test user expire after seven
// days, every time, and the only fix is to click Reconnect.
export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — Gmail ingestion cannot run.`);
  return v;
}

// ------------------------------------------------------------------
// Consent URL
// ------------------------------------------------------------------
// access_type=offline + prompt=consent is the only combination that reliably
// yields a refresh token. Without prompt=consent Google returns one on the
// *first* authorisation only, and a reconnect then silently produces a
// credential we cannot refresh.
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: env("GOOGLE_OAUTH_REDIRECT_URI"),
    response_type: "code",
    scope: [...GMAIL_SCOPES, "openid", "email"].join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ------------------------------------------------------------------
// Code → tokens
// ------------------------------------------------------------------
export interface ExchangedCredential {
  refreshToken: string;
  accessToken: string;
  emailAddress: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  let json: TokenResponse;
  try {
    json = (await res.json()) as TokenResponse;
  } catch {
    throw new Error(`Google token endpoint returned non-JSON (${res.status}).`);
  }

  // invalid_grant means the refresh token or auth code is dead. Everything
  // else — 5xx, rate limits, network — is transient and must not reauth.
  if (json.error === "invalid_grant") {
    throw new GmailAuthError(
      json.error_description ?? "Google rejected the credential (invalid_grant)."
    );
  }
  if (!res.ok || json.error) {
    throw new Error(
      `Google token endpoint failed (${res.status}): ${
        json.error_description ?? json.error ?? "unknown error"
      }`
    );
  }
  return json;
}

// Exchanges the one-time code from the callback for a long-lived refresh
// token. The address comes from Google's userinfo, never from anything the
// user typed — the mailbox we watch has to be the mailbox that consented.
export async function exchangeCode(code: string): Promise<ExchangedCredential> {
  const token = await postToken({
    code,
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: env("GOOGLE_OAUTH_REDIRECT_URI"),
    grant_type: "authorization_code",
  });

  if (!token.access_token) {
    throw new Error("Google returned no access token for the auth code.");
  }
  if (!token.refresh_token) {
    // Only happens if prompt=consent was dropped from the consent URL.
    throw new GmailAuthError(
      "Google returned no refresh token. Re-run the connect flow — consent must be forced."
    );
  }

  const emailAddress = await fetchEmailAddress(token.access_token);
  return {
    refreshToken: token.refresh_token,
    accessToken: token.access_token,
    emailAddress,
  };
}

async function fetchEmailAddress(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Could not read the Google account address (${res.status}).`);
  }
  const info = (await res.json()) as { email?: string };
  if (!info.email) {
    throw new Error("Google userinfo carried no email address.");
  }
  return info.email;
}

// ------------------------------------------------------------------
// Refresh token → access token
// ------------------------------------------------------------------
// Cached in-module for the token's own lifetime less a 60s safety margin, so
// draining twenty messages costs one token request rather than twenty. The
// cache is process-local and deliberately never persisted: losing it costs one
// extra round trip, and there is no invalidation problem to get wrong.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(refreshToken: string): Promise<string> {
  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  let token: TokenResponse;
  try {
    token = await postToken({
      refresh_token: refreshToken,
      client_id: env("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
      grant_type: "refresh_token",
    });
  } catch (e) {
    // A dead refresh token must never leave a usable entry behind.
    tokenCache.delete(refreshToken);
    throw e;
  }

  if (!token.access_token) {
    throw new Error("Google returned no access token on refresh.");
  }

  const lifetimeMs = ((token.expires_in ?? 3600) - 60) * 1000;
  tokenCache.set(refreshToken, {
    token: token.access_token,
    expiresAt: Date.now() + Math.max(lifetimeMs, 0),
  });
  return token.access_token;
}
