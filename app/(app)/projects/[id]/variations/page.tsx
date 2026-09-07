import { notFound } from "next/navigation";
import { getProject, getVariations } from "@/lib/data";
import VariationsScreen from "@/components/variations/VariationsScreen";

export const dynamic = "force-dynamic";

/**
 * Change orders (migration 0024) — what changed, why, and what it did.
 *
 * The app has always had `quoted_amount` and a variance against it, which is
 * the *result* of variations. This is the record of the variations themselves:
 * who asked, who agreed, what it was worth and how many days it added.
 */
export default async function VariationsPage({
  params,
}: {
  params: { id: string };
}) {
  const list = await getVariations(params.id);

  if (!list) {
    const project = await getProject(params.id);
    if (!project) notFound();
    return <VariationsScreen list={null} project={project} />;
  }

  return <VariationsScreen list={list} project={list.project} />;
}
