import { notFound } from "next/navigation";
import { getDocumentBundle, getProject } from "@/lib/data";
import DocumentsScreen from "@/components/documents/DocumentsScreen";

export const dynamic = "force-dynamic";

/**
 * Planning permission, building control, warranties, certificates, drawings
 * and site photographs (migration 0021).
 *
 * A route rather than a sixth project tab, deliberately. Five tabs is already
 * one more than the four the 2026-08-28 collapse settled on, and documents are
 * *browsed occasionally*, not monitored — they are not another way of looking
 * at the money, which is what earns a tab.
 */
export default async function DocumentsPage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getDocumentBundle(params.id);

  // Null from a project that does not exist is a 404; null because migration
  // 0021 has not been run is not — that is a message, not a missing page.
  if (!bundle) {
    const project = await getProject(params.id);
    if (!project) notFound();
    return <DocumentsScreen bundle={null} project={project} />;
  }

  return <DocumentsScreen bundle={bundle} project={bundle.project} />;
}
