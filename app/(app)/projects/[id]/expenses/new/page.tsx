import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectBundle } from "@/lib/data";
import AddExpensePanel from "@/components/forms/AddExpensePanel";

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
      <nav className="mb-4 text-sm text-gray-500">
        <Link href={`/projects/${bundle.project.id}`} className="hover:underline">
          {bundle.project.name}
        </Link>{" "}
        / Add expense
      </nav>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Add expense</h1>
      <div className="card">
        <AddExpensePanel
          projectId={bundle.project.id}
          trades={bundle.lookups}
          nextWeek={nextWeek}
          priorEntries={bundle.entries}
        />
      </div>
    </div>
  );
}
