import Directory from "@/components/directory/Directory";
import type { DirectoryView } from "@/components/directory/DirectoryScreen";

export const dynamic = "force-dynamic";

/**
 * The cross-project register: Suppliers, Items and People — one destination.
 *
 * The pivot lives in the URL rather than in component state, so a Directory
 * link says which third it means and the back button works between them.
 */
export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const requested = searchParams?.view;
  const view: DirectoryView =
    requested === "items"
      ? "items"
      : requested === "people"
        ? "people"
        : "suppliers";
  return <Directory view={view} />;
}
