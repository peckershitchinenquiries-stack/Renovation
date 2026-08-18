import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseEditBundle, getPurchaseFormBundle } from "@/lib/data";
import PurchaseForm from "@/components/forms/PurchaseForm";
import { EmptyState } from "@/components/ui/States";

export const dynamic = "force-dynamic";

export default async function EditPurchasePage({
  params,
}: {
  params: { id: string; pid: string };
}) {
  const [bundle, purchase] = await Promise.all([
    getPurchaseFormBundle(params.id),
    getPurchaseEditBundle(params.id, params.pid),
  ]);
  if (!bundle || !purchase) notFound();

  const crumbs = (
    <nav className="mb-4 text-sm text-gray-500">
      <Link href={`/projects/${bundle.project.id}`} className="hover:underline">
        {bundle.project.name}
      </Link>{" "}
      /{" "}
      <Link
        href={`/projects/${bundle.project.id}/purchases`}
        className="hover:underline"
      >
        Invoices
      </Link>{" "}
      / Edit
    </nav>
  );

  // The same rule the API enforces: a purchase copied from the week-by-week
  // sheet is the same money as its expense row, and that row is what the
  // Overview still reads. Editing it here would leave the two disagreeing.
  if (purchase.purchase.origin === "legacy_import")
    return (
      <div className="mx-auto max-w-4xl">
        {crumbs}
        <EmptyState
          title="This one is edited in the Expenses tab"
          description="It was copied from the week-by-week sheet by migration 0008, so the same purchase is recorded twice — once here and once as an expense row. The Expenses tab owns it until the two are merged."
          action={
            <Link href={`/projects/${bundle.project.id}`} className="btn-primary">
              Open the project
            </Link>
          }
        />
      </div>
    );

  return (
    <div className="mx-auto max-w-4xl">
      {crumbs}
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Edit invoice</h1>
      <p className="mb-4 text-sm text-gray-500">
        Saving replaces the document&rsquo;s lines and payments with what is
        below.
      </p>
      <PurchaseForm bundle={bundle} purchase={purchase} />
    </div>
  );
}
