import { notFound } from "next/navigation";
import { getProjectPurchases } from "@/lib/data";
import InvoicesTab from "@/components/project/InvoicesTab";

export const dynamic = "force-dynamic";

/**
 * The standalone invoice list.
 *
 * Since the four-tab collapse this is the same component as the project
 * screen's Invoices tab — the invoice edit form, the review screen and the
 * upload flow all redirect here, so the route stays. `chrome="page"` is the
 * only difference: standing on its own it needs the heading and breadcrumb
 * that the tab gets from the project header above it.
 */
export default async function ProjectPurchasesPage({
  params,
}: {
  params: { id: string };
}) {
  const list = await getProjectPurchases(params.id);
  if (!list) notFound();
  const { project, rows, totals } = list;

  return (
    <InvoicesTab
      project={project}
      rows={rows}
      totals={totals}
      chrome="page"
    />
  );
}
