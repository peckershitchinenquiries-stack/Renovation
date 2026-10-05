import { redirect } from "next/navigation";

/**
 * The old standalone invoice list — now a redirect to the project's Invoices
 * tab.
 *
 * Since the four-tab collapse this route rendered the SAME `InvoicesTab`
 * component as the tab did, with `chrome="page"`, which made it a second door
 * to one list: no hero stat, no tab strip, and an add button labelled "Log"
 * where the tab's says "Add". Saving an invoice landed you here rather than
 * back on the project, so a save felt like leaving the job rather than
 * returning to it.
 *
 * It stays as a route because the URL is in people's history and in older
 * links. It only ever showed one project's invoices, which is exactly what
 * `?tab=invoices` shows, so there is nothing to lose by sending both to the
 * same place.
 *
 * A nonexistent project id now 404s on the project page rather than here,
 * which is the same answer one step later.
 */
export default function ProjectPurchasesPage({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/projects/${params.id}?tab=invoices`);
}
