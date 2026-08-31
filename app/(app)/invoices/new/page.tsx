import { notFound } from "next/navigation";
import { getPurchaseFormBundle } from "@/lib/data";
import PurchaseForm from "@/components/forms/PurchaseForm";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";
import { PageHeader } from "@/components/ui/PageHeader";

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
      <PageHeader
        title="Log an invoice"
        subtitle="One document, as many lines as it has"
        backHref="/invoices"
        backLabel="Back to invoices"
      />
      <InvoiceScopeNote className="mb-4" />
      <PurchaseForm bundle={bundle} />
    </div>
  );
}
