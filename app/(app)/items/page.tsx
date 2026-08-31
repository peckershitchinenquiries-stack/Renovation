import Directory from "@/components/directory/Directory";

export const dynamic = "force-dynamic";

/**
 * See `suppliers/page.tsx` — same screen, the other half of the pivot.
 */
export default async function ItemsPage() {
  return <Directory view="items" />;
}
