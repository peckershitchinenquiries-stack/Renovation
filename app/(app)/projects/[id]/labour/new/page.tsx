import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeReturnTo } from "@/lib/safeReturnTo";
import LabourForm from "@/components/forms/LabourForm";
import type { Project, TradeLookup } from "@/types";

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
  const [{ data: project }, { data: trades }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", params.id).single(),
    supabase.from("trade_lookups").select("*"),
  ]);
  if (!project) notFound();
  const named = project as Project;

  // Untrusted: arrives on the query string, so it is validated before it can
  // reach router.push() inside the form.
  const returnTo = safeReturnTo(searchParams?.returnTo);

  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-4 text-sm text-gray-500">
        <Link href={`/projects/${named.id}`} className="hover:underline">
          {named.name}
        </Link>{" "}
        /{" "}
        <Link
          href={`/projects/${named.id}?tab=labour`}
          className="hover:underline"
        >
          Labour
        </Link>{" "}
        / Log labour
      </nav>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Log labour</h1>
      <p className="mb-4 text-sm text-gray-500">
        For work paid direct rather than invoiced. Saved as a Labour entry, so it
        shows up on the Labour, Trades, Suppliers and Overview tabs alongside
        everything else.
      </p>
      <div className="card">
        <LabourForm
          projectId={named.id}
          trades={(trades ?? []) as TradeLookup[]}
          returnTo={returnTo ?? undefined}
        />
      </div>
    </div>
  );
}
