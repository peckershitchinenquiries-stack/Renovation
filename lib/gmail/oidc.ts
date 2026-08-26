// Verifying the Google-signed OIDC token on a Pub/Sub push request.
//
// This exists because app/api/gmail/push/route.ts is the only URL in this
// project that is reachable without a session. Anyone on the internet can POST
// to it. The only thing standing between that and a forged notification is
// this file, so it verifies the *signature*, not merely the shape.
//
// Written against node:crypto rather than google-auth-library, matching
// lib/gmail/auth.ts: this is a JWKS fetch and one RSA verification, and adding
// a dependency to do it would hide the security-critical part behind an API
// rather than showing it.
//
// What gets checked, and why each one matters:
//
//   signature   — RS256 against Google's published key for the token's `kid`.
//                 Without this every other check is decoration.
//   iss         — accounts.google.com. Google signed it.
//   exp / iat   — with 60s of clock skew allowed. Stops replay of an old token.
//   aud         — must equal GMAIL_PUSH_AUDIENCE. This is what stops a token
//                 minted for somebody *else's* service being replayed at us:
//                 the audience is configured on our subscription alone.
//   email       — must equal GMAIL_PUSH_SERVICE_ACCOUNT, and be verified.
//                 Google signs tokens for every service account in the world;
//                 only ours may push here.
//
// Nothing here trusts the request body. The body is only read after this
// passes.

import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from "node:crypto";

const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const VALID_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Google rotates these keys on the order of days and publishes the new one
// well before it is used. An hour of caching turns a per-notification network
// round trip into roughly one a day, and a `kid` miss re-fetches immediately
// (see below), so a rotation costs one extra fetch rather than an outage.
const CACHE_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

let certCache: { keys: Jwk[]; fetchedAt: number } | null = null;

/** Raised for anything that means "do not trust this request". */
export class PushAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushAuthError";
  }
}

async function fetchCerts(force = false): Promise<Jwk[]> {
  if (!force && certCache && Date.now() - certCache.fetchedAt < CACHE_TTL_MS) {
    return certCache.keys;
  }
  const res = await fetch(CERTS_URL, { cache: "no-store" });
  if (!res.ok) {
    throw new PushAuthError(
      `Could not fetch Google's signing certificates (${res.status}).`
    );
  }
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!body.keys?.length) {
    throw new PushAuthError("Google's certificate endpoint returned no keys.");
  }
  certCache = { keys: body.keys, fetchedAt: Date.now() };
  return body.keys;
}

async function keyFor(kid: string): Promise<Jwk> {
  const keys = await fetchCerts();
  const hit = keys.find((k) => k.kid === kid);
  if (hit) return hit;

  // A `kid` we have never seen usually means Google rotated and our cache is
  // stale — not that the token is forged. One forced re-fetch settles it.
  const fresh = await fetchCerts(true);
  const retry = fresh.find((k) => k.kid === kid);
  if (!retry) {
    throw new PushAuthError(
      `The token was signed with a key Google does not publish (kid ${kid}).`
    );
  }
  return retry;
}

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(
    segment.replace(/-/g, "+").replace(/_/g, "/"),
    "base64"
  ).toString("utf8");
  return JSON.parse(json);
}

/** Constant-time string comparison, for the two claims an attacker controls. */
function claimEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface PushIdentity {
  email: string;
  audience: string;
  subject: string | null;
}

interface JwtHeader {
  alg?: string;
  kid?: string;
}

interface JwtPayload {
  iss?: string;
  aud?: string;
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  exp?: number;
  iat?: number;
}

/**
 * Verify a Pub/Sub push OIDC token, or throw PushAuthError.
 *
 * The caller turns any throw from here into a flat 401 with no detail — a
 * caller that cannot authenticate has no business learning *which* check it
 * failed.
 */
export async function verifyPushToken(
  token: string,
  expected: { audience: string; serviceAccountEmail: string }
): Promise<PushIdentity> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new PushAuthError("The bearer token is not a JWT.");
  }
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = decodeSegment(headerB64) as JwtHeader;
    payload = decodeSegment(payloadB64) as JwtPayload;
  } catch {
    throw new PushAuthError("The bearer token could not be decoded.");
  }

  // Only RS256. Refusing to look at `alg` at all is how the classic "alg: none"
  // and HMAC-confusion attacks get in.
  if (header.alg !== "RS256") {
    throw new PushAuthError(`Unsupported token algorithm: ${header.alg}.`);
  }
  if (!header.kid) {
    throw new PushAuthError("The token carries no key id.");
  }

  const jwk = await keyFor(header.kid);
  const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });

  const signatureValid = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(`${headerB64}.${payloadB64}`, "utf8"),
    publicKey,
    Buffer.from(signatureB64.replace(/-/g, "+").replace(/_/g, "/"), "base64")
  );
  if (!signatureValid) {
    throw new PushAuthError("The token signature does not verify.");
  }

  // ---- claims, only now that the signature is known good ----
  if (!payload.iss || !VALID_ISSUERS.includes(payload.iss)) {
    throw new PushAuthError(`Unexpected token issuer: ${payload.iss}.`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_S < now) {
    throw new PushAuthError("The token has expired.");
  }
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_S > now) {
    throw new PushAuthError("The token is not valid yet.");
  }

  if (!payload.aud || !claimEquals(payload.aud, expected.audience)) {
    throw new PushAuthError("The token was not issued for this endpoint.");
  }

  if (!payload.email || !claimEquals(payload.email, expected.serviceAccountEmail)) {
    throw new PushAuthError("The token belongs to a different service account.");
  }
  if (payload.email_verified === false) {
    throw new PushAuthError("The token's email claim is not verified.");
  }

  return {
    email: payload.email,
    audience: payload.aud,
    subject: payload.sub ?? null,
  };
}
