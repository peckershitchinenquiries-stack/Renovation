import { requireUser, json } from "@/lib/api";

export async function POST() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  await auth.supabase.auth.signOut();
  return json({ ok: true });
}
