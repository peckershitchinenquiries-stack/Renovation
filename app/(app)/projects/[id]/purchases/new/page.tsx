import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseFormBundle } from "@/lib/data";
import PurchaseForm from "@/components/forms/PurchaseForm";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";

export const dynamic = "force-dynamic";

export default async function NewPurchasePage({
  params,
}: {
  params: { id: string };
}) {
  const bundle = await getPurchaseFormBundle(params.id);
  if (!bundle) notFound();

  return (
    <div className="mx-auto max-w-4xl">
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
        / New
      </nav>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Log an invoice</h1>
      <p className="mb-3 text-sm text-gray-500">
        One document, as many lines as it has. Nails, plaster and planks bought
        on the same invoice stay on the same invoice.
      </p>
      <InvoiceScopeNote className="mb-4" />
      <PurchaseForm bundle={bundle} />
    </div>
  );
}
