import Directory from "@/components/directory/Directory";

export const dynamic = "force-dynamic";

/**
 * People are the third half of the Directory (migration 0020). This route
 * exists for the same reason `/suppliers` and `/items` do — so a link can name
 * the thing it means — and renders the same screen on its People segment.
 */
export default async function ContactsPage() {
  return <Directory view="people" />;
}
