import { notFound } from "next/navigation";
import { getProjectBundle, getScheduleBundle } from "@/lib/data";
import AddExpensePanel from "@/components/forms/AddExpensePanel";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  params,
}: {
  params: { id: string };
}) {
  // The schedule bundle is fetched only for the task tag on the form, and it
  // is tolerated failing: migrations here are run by hand, so on a database
  // where 0016 has not been pasted in the tables genuinely do not exist. The
  // tag then does not appear; adding an expense still works.
  const [bundle, schedule] = await Promise.all([
    getProjectBundle(params.id),
    getScheduleBundle(params.id).catch(() => null),
  ]);
  if (!bundle) notFound();

  const phaseNames = new Map((schedule?.phases ?? []).map((p) => [p.id, p.name]));
  const tasks = (schedule?.tasks ?? [])
    .filter((t) => t.status !== "Cancelled")
    .map((t) => ({
      id: t.id,
      name: t.name,
      phase_name: t.phase_id ? phaseNames.get(t.phase_id) ?? null : null,
      status: t.status,
    }));

  const nextWeek =
    bundle.entries.reduce((m, e) => Math.max(m, e.week_number), 0) + 1;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add expense"
        subtitle={bundle.project.name}
        backHref={`/projects/${bundle.project.id}`}
        backLabel="Back to project"
      />
      {/* The white card is the form's ground: its own fieldsets are sunken
          grey panels, which need something to sit on. */}
      <div className="card">
        <AddExpensePanel
          projectId={bundle.project.id}
          trades={bundle.lookups}
          nextWeek={nextWeek}
          priorEntries={bundle.entries}
          invoiceLines={bundle.invoiceLines}
          tasks={tasks}
        />
      </div>
    </div>
  );
}
