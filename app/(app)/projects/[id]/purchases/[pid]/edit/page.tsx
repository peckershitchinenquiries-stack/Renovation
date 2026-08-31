import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseEditBundle, getPurchaseFormBundle } from "@/lib/data";
import { safeReturnTo } from "@/lib/safeReturnTo";
import PurchaseForm from "@/components/forms/PurchaseForm";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({
  params,
  searchParams,
}: {
  params: { id: string; pid: string };
  searchParams: { returnTo?: string };
}) {
  const [bundle, purchase] = await Promise.all([
    getPurchaseFormBundle(params.id),
    getPurchaseEditBundle(params.id, params.pid),
  ]);
  // Where Cancel and Save should land, if the caller asked for somewhere other
  // than the default invoice list — e.g. the Expenses tab, which links here
  // with ?returnTo=/projects/<id>?tab=expenses. Untrusted input: validated
  // before it ever reaches PurchaseForm's router.push().
  const returnTo = safeReturnTo(searchParams?.returnTo);
  // bundle.project is only null when the bundle was loaded without a project
  // (the nav-bar invoice flow). This route always names one, so a bundle
  // without it here means the project itself is gone.
  if (!bundle?.project || !purchase) notFound();
  const project = bundle.project;

  // The two-level breadcrumb is gone: on a phone it wrapped to two lines above
  // every heading. The header's back arrow goes to the invoice list, which is
  // where this screen is opened from.
  const backHref = returnTo ?? `/projects/${project.id}/purchases`;

  // The same rule the API enforces: a purchase copied from the week-by-week
  // sheet is the same money as its expense row, and that row is what the
  // Overview still reads. Editing it here would leave the two disagreeing.
  if (purchase.purchase.origin === "legacy_import")
    return (
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Edit invoice"
          subtitle={project.name}
          backHref={backHref}
          backLabel="Back to invoices"
        />
        <EmptyState
          icon="info"
          title="This one is edited in the Costs tab"
          description="It was copied from the week-by-week sheet by migration 0008, so the same purchase is recorded twice — once here and once as an expense row. The Costs tab owns it until the two are merged."
          action={
            <Link href={`/projects/${project.id}`} className="btn-primary">
              Open the project
            </Link>
          }
        />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Edit invoice"
        subtitle={project.name}
        backHref={backHref}
        backLabel="Back to invoices"
      />
      <p className="mb-4 text-[0.8125rem] leading-relaxed text-gray-500">
        Saving replaces the document&rsquo;s lines and payments with what is
        below.
      </p>
      <PurchaseForm
        bundle={bundle}
        purchase={purchase}
        returnTo={returnTo ?? undefined}
      />
    </div>
  );
}
