import Link from "next/link";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";
import UploadInvoicePanel from "@/components/purchases/UploadInvoicePanel";

export const dynamic = "force-dynamic";

export default function UploadInvoicePage() {
  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/invoices" className="hover:underline">
          Invoices
        </Link>{" "}
        / Upload
      </nav>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">
        Upload an invoice
      </h1>
      <p className="mb-3 text-sm text-gray-500">
        Drop in a photo or PDF, or add more than one at once. Each is read
        automatically — you choose the project, and check everything else, on
        the review screen. Nothing is saved until then.
      </p>
      <InvoiceScopeNote className="mb-4" />
      <UploadInvoicePanel />
    </div>
  );
}
