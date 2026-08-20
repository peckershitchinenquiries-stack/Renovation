import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseFormBundle } from "@/lib/data";
import PurchaseForm from "@/components/forms/PurchaseForm";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";

export const dynamic = "force-dynamic";

// Manual entry, with no project in the route — the form asks for one. Passing
// null is what makes getPurchaseFormBundle return every project rather than
// one; everything else it loads (suppliers, items, trades, price history) was
// always cross-project anyway.
export default async function NewInvoicePage() {
  const bundle = await getPurchaseFormBundle(null);
  if (!bundle) notFound();

  return (
    <div className="mx-auto max-w-4xl">
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/invoices" className="hover:underline">
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
