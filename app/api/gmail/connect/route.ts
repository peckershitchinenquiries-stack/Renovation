// GET /api/gmail/connect — start the Google OAuth consent flow.
//
// Redirects the browser to Google. The only state we keep is a random nonce in
// an httpOnly cookie, which the callback checks: without it, anyone could hand
// the user a crafted callback URL and attach *their* mailbox to this account.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/api";
import { buildAuthUrl, OAUTH_STATE_COOKIE } from "@/lib/gmail/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const state = crypto.randomUUID();

  let url: string;
  try {
    url = buildAuthUrl(state);
  } catch (e) {
    // Almost always a missing GOOGLE_OAUTH_* env var. Say so on /settings
    // rather than returning a 500 with no clue what to do about it.
    const message =
      e instanceof Error ? e.message : "Could not build the consent URL";
    return NextResponse.redirect(
      new URL(`/settings?gmail_error=${encodeURIComponent(message)}`, request.url)
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the redirect back from Google
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // the user has ten minutes to finish consenting
  });
  return res;
}
