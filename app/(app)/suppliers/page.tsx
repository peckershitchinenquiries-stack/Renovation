import Directory from "@/components/directory/Directory";

export const dynamic = "force-dynamic";

/**
 * Suppliers and Items are one nav destination now — Directory — with a pivot
 * between them. This route stays because a great many links point at it, and
 * renders the same screen on its Suppliers half.
 */
export default async function SuppliersPage() {
  return <Directory view="suppliers" />;
}
