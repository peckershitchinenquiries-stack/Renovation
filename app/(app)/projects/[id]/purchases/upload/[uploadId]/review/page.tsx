import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPurchaseFormBundle } from "@/lib/data";
import PurchaseForm, { type PurchaseFormPrefill } from "@/components/forms/PurchaseForm";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";
import { EmptyState } from "@/components/ui/States";
import { parseExtraction } from "@/lib/invoice/schema";
import { documentNotes as buildDocumentNotes } from "@/lib/invoice/reconcile";
import { normaliseExtraction } from "@/lib/invoice/normalise";
import { resolveSupplier, resolveItems } from "@/lib/invoice/resolve";
import type { InvoiceUpload } from "@/types";

export const dynamic = "force-dynamic";

const BUCKET = "invoices";

// Phase 5b: the screen an extracted invoice actually gets accepted or
// corrected on. Reuses components/forms/PurchaseForm.tsx, prefilled from the
// extraction — there is exactly one purchase form in this codebase
// (invoice-ingestion-prompt.md, "THE ONE RULE THAT MATTERS"). This file's
// job is entirely getting the extraction into that form's shape; nothing
// here writes anything — POST /api/invoices/[id]/commit does that, once the
// form is submitted.
export default async function ReviewInvoicePage({
  params,
}: {
  params: { id: string; uploadId: string };
}) {
  const supabase = createClient();
  const [{ data: uploadRow }, bundle] = await Promise.all([
    supabase.from("invoice_uploads").select("*").eq("id", params.uploadId).single(),
    getPurchaseFormBundle(params.id),
  ]);
  if (!uploadRow || !bundle) notFound();
  const upload = uploadRow as InvoiceUpload;

  const crumbs = (
    <nav className="mb-4 text-sm text-gray-500">
      <Link href={`/projects/${params.id}`} className="hover:underline">
        {bundle.project.name}
      </Link>{" "}
      /{" "}
      <Link href={`/projects/${params.id}/purchases`} className="hover:underline">
        Invoices
      </Link>{" "}
      /{" "}
      <Link href={`/projects/${params.id}/purchases/upload`} className="hover:underline">
        Upload
      </Link>{" "}
      / Review
    </nav>
  );

  // Already saved — this upload has nothing left to review.
  if (upload.status === "committed") {
    return (
      <div className="mx-auto max-w-2xl">
        {crumbs}
        <EmptyState
          title="Already saved"
          description="This upload was already committed to an invoice."
          action={
            upload.invoice_id ? (
              <Link
                href={`/projects/${params.id}/purchases/${upload.invoice_id}/edit`}
                className="btn-primary"
              >
                Open the invoice
              </Link>
            ) : (
              <Link href={`/projects/${params.id}/purchases`} className="btn-primary">
                Back to invoices
              </Link>
            )
          }
        />
      </div>
    );
  }

  // Not read yet, still reading, or reading failed — nothing to review.
  if (upload.status !== "extracted") {
    return (
      <div className="mx-auto max-w-2xl">
        {crumbs}
        <EmptyState
          title={upload.status === "failed" ? "This upload failed" : "Still processing"}
          description={
            upload.status === "failed"
              ? (upload.error ?? "Extraction failed for an unknown reason.")
              : "Come back once it finishes reading, or refresh in a moment."
          }
          action={
            <Link href={`/projects/${params.id}/purchases/upload`} className="btn-primary">
              Back to upload queue
            </Link>
          }
        />
      </div>
    );
  }

  // extraction_raw is stored as evidence, not a contract (types/index.ts) —
  // re-validated here rather than trusted.
  const extraction = parseExtraction(upload.extraction_raw);
  if (!extraction) {
    return (
      <div className="mx-auto max-w-2xl">
        {crumbs}
        <EmptyState
          title="This extraction can't be read"
          description="The stored result doesn't match the expected shape. Retry the upload, or enter the invoice by hand."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`/projects/${params.id}/purchases/upload`} className="btn-secondary">
                Back to upload queue
              </Link>
              <Link href={`/projects/${params.id}/purchases/new`} className="btn-primary">
                Enter manually
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  // A longer window than the GET route's 5 minutes (about.md §8.2) — this
  // page is meant to be read and corrected, not just glanced at, and a
  // review that outlives even 10 minutes can simply be reloaded.
  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(upload.storage_path, 60 * 10);

  const notes = buildDocumentNotes(extraction);
  const normalised = normaliseExtraction(extraction);

  // Resolved fresh against the current suppliers/items, not the snapshot the
  // extract route saw — a supplier added since then should still match.
  const [supplierResolution, lineResolutions] = await Promise.all([
    resolveSupplier(supabase, {
      name: normalised.supplier_name,
      vat_number: normalised.supplier_vat_number,
      address: normalised.supplier_address,
      upload_id: upload.id,
    }),
    resolveItems(supabase, normalised.lines.map((l) => l.description_raw)),
  ]);

  const todayISO = new Date().toISOString().slice(0, 10);
  const prefill: PurchaseFormPrefill = {
    purchase_date: normalised.invoice_date ?? todayISO,
    invoice_no: normalised.invoice_no ?? "",
    category: normalised.category ?? "Materials",
    location_room: "",
    notes: normalised.notes ?? "",
    lines: normalised.lines.map((l) => ({
      description_raw: l.description_raw,
      qty: l.qty && l.qty > 0 ? String(l.qty) : "",
      unit: l.unit ?? "",
      unit_price: l.unit_price && l.unit_price > 0 ? String(l.unit_price) : "",
      line_net: l.line_net != null ? String(l.line_net) : "",
      // The rate the document printed, kept as printed — 0, 5 or 20 all
      // survive normaliseVatRate now (migration 0011). It is left BLANK, not
      // defaulted to 0, when the document's rate is one the CHECK constraint
      // would reject: a blank box the form refuses to save is a question, and
      // a 0 nobody chose is a wrong number. documentNotes says which rate was
      // read and could not be stored.
      vat_rate: l.vat_rate != null ? String(l.vat_rate) : "",
    })),
    payments:
      normalised.amount_paid && normalised.amount_paid > 0
        ? [
            {
              paid_on: normalised.invoice_date ?? "",
              amount: String(normalised.amount_paid),
              method: normalised.payment_method ?? "",
              reference: "",
            },
          ]
        : [],
    stated_gross: normalised.gross_total != null ? String(normalised.gross_total) : "",
  };

  const isPdf = upload.mime_type === "application/pdf";

  return (
    <div className="mx-auto max-w-6xl">
      {crumbs}
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Review invoice</h1>
      <p className="mb-3 text-sm text-gray-500">
        Everything below was read automatically from{" "}
        {upload.original_name ?? "the file"} — check it against the original
        and correct anything that&rsquo;s wrong. Nothing here blocks saving.
      </p>
      <InvoiceScopeNote className="mb-4" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="card overflow-hidden p-0">
            {signed?.signedUrl ? (
              isPdf ? (
                <iframe
                  src={signed.signedUrl}
                  title={upload.original_name ?? "Invoice"}
                  className="h-[70vh] w-full"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signed.signedUrl}
                  alt={upload.original_name ?? "Invoice"}
                  className="max-h-[80vh] w-full object-contain"
                />
              )
            ) : (
              <p className="p-4 text-sm text-gray-500">
                The original file couldn&rsquo;t be loaded.
              </p>
            )}
          </div>
        </div>

        <PurchaseForm
          bundle={bundle}
          prefill={prefill}
          invoiceUploadId={upload.id}
          supplierResolution={supplierResolution}
          lineResolutions={lineResolutions}
          extractedTotals={{
            net_total: normalised.net_total,
            vat_total: normalised.vat_total,
          }}
          documentNotes={notes}
        />
      </div>
    </div>
  );
}
