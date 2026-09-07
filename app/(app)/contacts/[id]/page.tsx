import { notFound } from "next/navigation";
import { getContactBundle } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import ContactScreen from "@/components/directory/ContactScreen";
import type { TradeLookup } from "@/types";

export const dynamic = "force-dynamic";

/**
 * One person: details, rates, certificates with their expiry state, the work
 * assigned to them, and the labour paid to them (migration 0020).
 */
export default async function ContactPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const [bundle, { data: trades }, { data: suppliers }] = await Promise.all([
    // A missing `contacts` table throws here rather than returning null, so it
    // is caught: a person page on a database without 0020 is a 404, which is
    // honest — that person genuinely does not exist yet.
    getContactBundle(params.id).catch(() => null),
    supabase.from("trade_lookups").select("*").order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  if (!bundle) notFound();

  return (
    <ContactScreen
      bundle={bundle}
      trades={(trades ?? []) as TradeLookup[]}
      suppliers={(suppliers ?? []) as { id: string; name: string }[]}
    />
  );
}
