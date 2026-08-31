import { InvoiceScopeNote } from "@/components/purchases/SourceNote";
import UploadInvoicePanel from "@/components/purchases/UploadInvoicePanel";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

export default function UploadInvoicePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Upload an invoice"
        subtitle="Read automatically — nothing saves until you check it"
        backHref="/invoices"
        backLabel="Back to invoices"
      />
      <InvoiceScopeNote className="mb-4" />
      <UploadInvoicePanel />
    </div>
  );
}
