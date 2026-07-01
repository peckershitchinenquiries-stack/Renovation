// Helpers shared by Route Handlers — auth guard + JSON responses.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400, extra?: unknown) {
  if (status >= 500) {
    // Surface the real cause in the dev terminal.
    console.error(`[api ${status}]`, message, extra ?? "");
  }
  return NextResponse.json({ error: message, ...(extra ? { details: extra } : {}) }, { status });
}

// Returns the authenticated user + supabase client, or a 401 response.
export async function requireUser(): Promise<
  { user: User; supabase: SupabaseClient } | { response: NextResponse }
> {
  const supabase = createClient();
  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError) {
      console.error("[api auth] getUser error:", authError.message);
      return { response: error("Not authenticated", 401) };
    }
    if (!user) return { response: error("Not authenticated", 401) };
    return { user, supabase };
  } catch (e) {
    console.error("[api auth] getUser threw:", e);
    return { response: error("Auth check failed", 500) };
  }
}
