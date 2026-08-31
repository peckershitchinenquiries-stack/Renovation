import { getItems, getSuppliers } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import DirectoryScreen, { type DirectoryView } from "./DirectoryScreen";
import type { Project } from "@/types";

/**
 * The Directory's server half: fetch one side of the register, then hand it to
 * the client screen.
 *
 * Only the half being looked at is fetched — `getSuppliers()` and `getItems()`
 * each read the whole transaction core, so loading both to render one would
 * double the work on every visit. That is why the pivot lives in the URL here
 * and in component state on the project screen's Analysis tab: there, all four
 * pivots come out of one bundle that has already been fetched.
 *
 * Rendered by `/directory`, and by `/suppliers` and `/items`, which still exist
 * because a great many links point at them.
 */
export default async function Directory({ view }: { view: DirectoryView }) {
  const supabase = createClient();
  // Just the names, for the scope control. No user_id filter anywhere: RLS
  // does the scoping (CLAUDE.md, "Queries never filter by user").
  const [suppliers, items, { data: projects }] = await Promise.all([
    view === "suppliers" ? getSuppliers() : Promise.resolve(null),
    view === "items" ? getItems() : Promise.resolve(null),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  return (
    <DirectoryScreen
      view={view}
      suppliers={suppliers}
      items={items}
      projects={(projects ?? []) as Pick<Project, "id" | "name">[]}
    />
  );
}
