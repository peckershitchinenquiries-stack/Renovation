import Directory from "@/components/directory/Directory";
import type { DirectoryView } from "@/components/directory/DirectoryScreen";

export const dynamic = "force-dynamic";

/**
 * The cross-project register: Suppliers and Items, one destination.
 *
 * The pivot lives in the URL rather than in component state, so a Directory
 * link says which half it means and the back button works between the two.
 */
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view: DirectoryView =
    searchParams?.view === "items" ? "items" : "suppliers";
  return <Directory view={view} />;
}
