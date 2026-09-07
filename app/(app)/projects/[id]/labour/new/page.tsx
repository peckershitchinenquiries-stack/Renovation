import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/safeReturnTo";
import LabourForm from "@/components/forms/LabourForm";
import { PageHeader } from "@/components/ui/PageHeader";
import type {
  Contact,
  Project,
  TaskRef,
  TaskStatus,
  TradeLookup,
} from "@/types";

export const dynamic = "force-dynamic";

// Only two things are needed here — the project's name for the breadcrumb, and
// the trade list for the select — so this reads them directly rather than
// calling getProjectBundle, which would pull every entry, purchase, line and
// payment in the project to render a blank form. Neither query filters by
// user_id: RLS does the scoping (CLAUDE.md, "Queries never filter by user").
export default async function NewLabourPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { returnTo?: string };
}) {
  const supabase = createClient();
  // A third small query joins the two: the task list for the task tag. It is
  // deliberately tolerant — migrations here are applied by hand, so on a
  // database where 0016 has not been run these tables do not exist, and a
  // labour form that 500s because the SCHEDULE is not installed would be an
  // absurd coupling. The tag simply does not appear.
  // The people register (0020) is read the same tolerant way, and for the same
  // reason: it only fills the name, trade and rate in, so a database without
  // 0020 simply has no shortcut and the form works exactly as before.
  const [
    { data: project },
    { data: trades },
    { data: taskRows },
    { data: phaseRows },
    { data: contacts },
  ] = await Promise.all([
      supabase.from("projects").select("*").eq("id", params.id).single(),
      supabase.from("trade_lookups").select("*"),
      supabase
        .from("tasks")
        .select("id, name, status, phase_id")
        .eq("project_id", params.id)
        .neq("status", "Cancelled")
        .order("sort_order"),
      supabase.from("project_phases").select("id, name").eq("project_id", params.id),
      supabase.from("contacts").select("*").order("name"),
    ]);
  if (!project) notFound();
  const named = project as Project;

  // Untrusted: arrives on the query string, so it is validated before it can
  // reach router.push() inside the form.
  const returnTo = safeReturnTo(searchParams?.returnTo);

  const phaseNames = new Map(
    ((phaseRows ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name])
  );
  const tasks: TaskRef[] = (
    (taskRows ?? []) as { id: string; name: string; status: TaskStatus; phase_id: string | null }[]
  ).map((t) => ({
    id: t.id,
    name: t.name,
    phase_name: t.phase_id ? phaseNames.get(t.phase_id) ?? null : null,
    status: t.status,
  }));

  return (
    <div className="mx-auto max-w-2xl">
      {/* The three-level breadcrumb is gone — on a phone it wrapped onto two
          lines above the heading. The back arrow goes where it pointed. */}
      <PageHeader
        title="Log labour"
        subtitle={named.name}
        backHref={returnTo ?? `/projects/${named.id}?tab=analysis&view=labour`}
        backLabel="Back to labour"
      />
      <p className="mb-4 text-[0.8125rem] leading-relaxed text-gray-500">
        For work paid direct rather than invoiced. Saved as a Labour entry, so it
        shows up on the Overview, Costs and Analysis tabs alongside everything
        else.
      </p>
      <div className="card">
        <LabourForm
          projectId={named.id}
          trades={(trades ?? []) as TradeLookup[]}
          tasks={tasks}
          contacts={(contacts ?? []) as Contact[]}
          returnTo={returnTo ?? undefined}
        />
      </div>
    </div>
  );
}
