import { notFound } from "next/navigation";
import {
  getProjectBundle,
  getProjectPurchases,
  getScheduleBundle,
} from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import ProjectDetail from "@/components/project/ProjectDetail";
import type { Contact } from "@/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  // Five loaders, in parallel. getProjectPurchases builds the invoice rows for
  // the Invoices tab, which used to be the separate /purchases route and is
  // still served there by the same component.
  //
  // It re-reads purchases, lines, payments and suppliers that getProjectBundle
  // has already fetched, which is the price of this arrangement: the queries
  // run on every project page load whether or not the tab is opened. Taken
  // deliberately — one row builder means the tab and the route can never
  // disagree, and the tab refreshes on router.refresh() like everything else,
  // where a client fetch would need its own loading and refresh wiring.
  //
  // getScheduleBundle is the third, and it overlaps with nothing: phases,
  // tasks, dependencies, the current baseline and the recent revision log are
  // read by no other loader. Per-task COST is not fetched here — it is derived
  // in the browser from the invoice lines the bundle above already carries.
  const supabase = createClient();
  const [bundle, purchaseList, scheduleBundle, openSnags, contacts] =
    await Promise.all([
      getProjectBundle(params.id),
      getProjectPurchases(params.id),
      // Migrations in this project are run by hand, so the schedule tables may
      // genuinely not exist yet on a database where 0016 has not been pasted in.
      // That is a "run the migration" message on one tab, not a 500 on the whole
      // project page.
      getScheduleBundle(params.id).catch(() => null),
      // Open snags (migration 0022). A count only — the list itself lives on its
      // own route. An open SAFETY snag should never need looking for, which is
      // why this figure is carried all the way up to the project header rather
      // than sitting behind a tap. Tolerated failing for the same reason as the
      // schedule: 0022 may not have been run.
      supabase
        .from("snags")
        .select("severity", { count: "exact" })
        .eq("project_id", params.id)
        .eq("status", "open")
        .then(
          (r) => ({
            count: r.count ?? 0,
            safety: ((r.data ?? []) as { severity: string }[]).filter(
              (s) => s.severity === "safety",
            ).length,
          }),
          () => ({ count: 0, safety: 0 }),
        ),
      // The people register (migration 0020), for the Schedule tab's assignee
      // picker. Cross-project, like suppliers and items — the same plasterer
      // works on more than one job. Empty when 0020 has not been run.
      supabase
        .from("contacts")
        .select("*")
        .order("name")
        .then(
          (r) => (r.data ?? []) as Contact[],
          () => [] as Contact[],
        ),
    ]);
  if (!bundle) notFound();

  return (
    <ProjectDetail
      openSnagCount={openSnags.count}
      openSafetySnagCount={openSnags.safety}
      project={bundle.project}
      initialEntries={bundle.entries}
      trades={bundle.lookups}
      initialWeeks={bundle.weeks}
      invoiceTotals={bundle.invoiceTotals}
      invoiceLines={bundle.invoiceLines}
      purchases={bundle.purchases}
      supplierNames={bundle.supplierNames}
      purchaseRows={purchaseList?.rows ?? []}
      scheduleBundle={scheduleBundle}
      contacts={contacts}
    />
  );
}
