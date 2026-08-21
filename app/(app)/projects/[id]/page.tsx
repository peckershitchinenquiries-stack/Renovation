import { notFound } from "next/navigation";
import { getProjectBundle } from "@/lib/data";
import ProjectDetail from "@/components/project/ProjectDetail";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getProjectBundle(params.id);
  if (!bundle) notFound();

  return (
    <ProjectDetail
      project={bundle.project}
      initialEntries={bundle.entries}
      trades={bundle.lookups}
      initialWeeks={bundle.weeks}
      invoiceTotals={bundle.invoiceTotals}
      invoiceLines={bundle.invoiceLines}
      purchases={bundle.purchases}
      supplierNames={bundle.supplierNames}
      documentPurchaseIds={bundle.documentPurchaseIds}
    />
  );
}

