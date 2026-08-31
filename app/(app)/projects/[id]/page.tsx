import { notFound } from "next/navigation";
import { getProjectBundle, getProjectPurchases } from "@/lib/data";
import ProjectDetail from "@/components/project/ProjectDetail";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  // Two loaders, in parallel. getProjectPurchases builds the invoice rows for
  // the Invoices tab, which used to be the separate /purchases route and is
  // still served there by the same component.
  //
  // It re-reads purchases, lines, payments and suppliers that getProjectBundle
  // has already fetched, which is the price of this arrangement: the queries
  // run on every project page load whether or not the tab is opened. Taken
  // deliberately — one row builder means the tab and the route can never
  // disagree, and the tab refreshes on router.refresh() like everything else,
  // where a client fetch would need its own loading and refresh wiring.
  const [bundle, purchaseList] = await Promise.all([
    getProjectBundle(params.id),
    getProjectPurchases(params.id),
  ]);
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
      purchaseRows={purchaseList?.rows ?? []}
    />
  );
}
