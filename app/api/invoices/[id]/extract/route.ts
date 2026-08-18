import { requireUser, json, error } from "@/lib/api";
import { extractInvoice, ExtractionError } from "@/lib/invoice/extract";
import { InvoiceExtractionSchema } from "@/lib/invoice/schema";
import { reconcile, documentNotes } from "@/lib/invoice/reconcile";
import { normaliseExtraction } from "@/lib/invoice/normalise";
import { resolveSupplier, resolveItems } from "@/lib/invoice/resolve";
import type { InvoiceUpload } from "@/types";

// Reading a whole invoice with adaptive thinking can comfortably take longer
// than a default serverless timeout.
export const maxDuration = 60;

// Step 2: turn an uploaded file into a proposed invoice.
//
// Every path out of this function — success, a bad extraction, a storage
// failure, an unhandled exception — lands the row on a terminal status
// ('extracted' or 'failed'). Nothing is allowed to leave it sitting in
// 'processing': that would be a stuck spinner with no way back. A 'failed'
// row is retryable simply by POSTing here again on the same id.
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: uploadRow } = await auth.supabase
    .from("invoice_uploads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!uploadRow) return error("Upload not found", 404);
  const upload = uploadRow as InvoiceUpload;

  if (upload.status === "committed")
    return error("This upload has already been committed to a purchase.", 409);

  await auth.supabase
    .from("invoice_uploads")
    .update({ status: "processing", error: null })
    .eq("id", upload.id);

  try {
    const { data: file, error: dlError } = await auth.supabase.storage
      .from("invoices")
      .download(upload.storage_path);
    if (dlError || !file)
      throw new ExtractionError(
        `Could not read the uploaded file from storage: ${dlError?.message ?? "not found"}`
      );

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { extraction: rawExtraction, method, page_count } = await extractInvoice(
      bytes,
      upload.mime_type ?? ""
    );

    // Belt-and-braces: extractInvoice already asks the model for structured
    // output against this schema, but extraction_raw is stored as evidence,
    // not a contract (types/index.ts), so it is re-checked here before
    // anything downstream trusts its shape.
    const parsed = InvoiceExtractionSchema.safeParse(rawExtraction);
    if (!parsed.success)
      throw new ExtractionError(
        `The extraction did not match the expected shape: ${parsed.error.message}`
      );
    const extraction = parsed.data;

    const warnings = reconcile(extraction);
    const notes = documentNotes(extraction);
    const normalised = normaliseExtraction(extraction);

    const supplier = await resolveSupplier(auth.supabase, {
      name: normalised.supplier_name,
      vat_number: normalised.supplier_vat_number,
      address: normalised.supplier_address,
      upload_id: upload.id,
    });
    const items = await resolveItems(
      auth.supabase,
      normalised.lines.map((line) => line.description_raw)
    );

    const { data: updated, error: updateError } = await auth.supabase
      .from("invoice_uploads")
      .update({
        status: "extracted",
        // Stored exactly as the model returned it — see extraction_raw's
        // comment in migration 0010 and types/index.ts.
        extraction_raw: extraction,
        extraction_method: method,
        page_count,
        error: null,
      })
      .eq("id", upload.id)
      .select("*")
      .single();
    if (updateError) throw new ExtractionError(updateError.message);

    return json({
      upload: updated,
      extraction,
      normalised,
      reconcile: warnings,
      document_notes: notes,
      supplier,
      items,
    });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Extraction failed for an unknown reason.";
    await auth.supabase
      .from("invoice_uploads")
      .update({ status: "failed", error: message })
      .eq("id", upload.id);
    return error(message, e instanceof ExtractionError ? 422 : 500);
  }
}
