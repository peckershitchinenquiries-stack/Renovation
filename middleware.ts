import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Match all paths except static assets and image optimisation files.
    //
    // /api/gmail/push is excluded deliberately: it is the Pub/Sub push
    // endpoint, called machine-to-machine by Google with no Supabase session
    // and no cookies. Refreshing a session that does not exist is pure work on
    // the hot path of an endpoint that has ten seconds to acknowledge. It
    // authenticates itself — see the header of that route.
    "/((?!_next/static|_next/image|favicon.ico|api/gmail/push|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
