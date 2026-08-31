import { notFound } from "next/navigation";
import { getProjectBundle } from "@/lib/data";
import AddExpensePanel from "@/components/forms/AddExpensePanel";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function NewExpensePage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getProjectBundle(params.id);
  if (!bundle) notFound();

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
        />
      </div>
    </div>
  );
}
