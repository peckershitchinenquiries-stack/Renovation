import { notFound } from "next/navigation";
import { getCommunicationBundle, getProject } from "@/lib/data";
import LogScreen from "@/components/snags/LogScreen";

export const dynamic = "force-dynamic";

/**
 * What happened, and what is wrong (migration 0022).
 *
 * One route with two segments rather than two routes, because they are the
 * same act of recording from the same place at the same moment: you walk the
 * job, you note that the inspector called, and you note the three things that
 * need doing again. Splitting them across two destinations means half of what
 * you saw never gets written down.
 *
 * A route rather than a tab, for the reason the documents screen gives: five
 * project tabs is already one more than the 2026-08-28 collapse settled on,
 * and neither of these is another way of looking at the money.
 */
export default async function LogPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { view?: string };
}) {
  const bundle = await getCommunicationBundle(params.id);

  if (!bundle) {
    const project = await getProject(params.id);
    if (!project) notFound();
    return <LogScreen bundle={null} project={project} initialView="activity" />;
  }

  return (
    <LogScreen
      bundle={bundle}
      project={bundle.project}
      // `?view=snags` so the snag count in the project header can link
      // straight to the list it is counting.
      initialView={searchParams?.view === "snags" ? "snags" : "activity"}
    />
  );
}
