// Running an extraction for a Gmail-sourced upload, from the drain.
//
// Why this file exists at all
// ---------------------------
// The obvious thing would be for the drain to POST to the existing
// /api/invoices/[id]/extract. It cannot: that route starts with requireUser(),
// which reads the Supabase session out of **cookies**, and a Vercel cron
// request has no session and no way to mint one. Every such POST would be a
// 401.
//
// So this runs the same work in-process instead. It is deliberately a
// transcription of that route's body, not a reimplementation:
//
//   * the same extractInvoice() from lib/invoice/extract.ts
//   * the same re-check against InvoiceExtractionSchema
//   * the same four columns written on success
//     (status / extraction_raw / extraction_method / page_count)
//   * the same rule that nothing is ever left sitting at 'processing'
//
// The row therefore lands in exactly the state a hand-uploaded file's row
// lands in, and the review screen and commit route cannot tell the two apart —
// which is the point. A human still reviews every invoice before commit.
//
// resolveSupplier() and resolveItems() are *not* called here. They are
// read-only, and the review page re-resolves both itself rather than trusting
// what the extract route saw (app/(app)/invoices/[uploadId]/review/page.tsx),
// so running them from a cron would produce a payload nobody reads.
//
// **Service-role, no RLS (R3 exception).** There is no auth.uid() on a cron
// request, so every statement below is scoped by an explicit .eq("user_id", …)
// against the owning gmail_accounts row. See about.md §8.4.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractInvoice, ExtractionError } from "@/lib/invoice/extract";
import { InvoiceExtractionSchema } from "@/lib/invoice/schema";
import type { InvoiceUpload } from "@/types";

// Gemini's requests-per-minute is the real ceiling on ingestion, not Gmail's.
// Three at a time keeps a ten-attachment morning inside one drain tick without
// walking into a 429 on every call.
const CONCURRENCY = 3;

// Two retries, widely spaced. A 429 is a per-minute quota, so retrying in
// milliseconds is pointless and retrying for a minute would eat the function's
// whole time budget — after this the upload is simply left for the next tick.
const BACKOFF_MS = [4000, 12000];

/**
 * Prefix on the `error` column when extraction was throttled rather than
 * defeated.
 *
 * This distinction is the point of the whole retry path: "we ran out of quota,
 * this will be picked up again" and "this document cannot be read" look
 * identical on screen otherwise, and only one of them is worth a human's
 * attention. A throttled row stays at 'pending', never 'failed'.
 */
export const RATE_LIMIT_PREFIX = "Rate limited by the extractor";

export interface ExtractOutcome {
  upload_id: string;
  status: "extracted" | "failed" | "pending";
  error: string | null;
}

/**
 * Is this failure Gemini saying "not now" rather than "not ever"?
 *
 * lib/invoice/extract.ts wraps any SDK throw in an ExtractionError whose
 * `cause` is the original, so both are inspected. Matching on text is
 * unpleasant but it is what the SDK gives us — a false positive here costs one
 * retry, and a false negative costs a wrongly-'failed' row.
 */
function isRateLimited(e: unknown): boolean {
  const texts: string[] = [];
  if (e instanceof ExtractionError) {
    texts.push(e.message);
    if (e.cause instanceof Error) texts.push(e.cause.message);
    const status = (e.cause as { status?: unknown } | undefined)?.status;
    if (status === 429) return true;
  } else if (e instanceof Error) {
    texts.push(e.message);
  }
  const haystack = texts.join(" ").toLowerCase();
  return (
    haystack.includes("429") ||
    haystack.includes("resource_exhausted") ||
    haystack.includes("rate limit") ||
    haystack.includes("quota")
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract one upload. Never throws — every path returns an outcome and leaves
 * the row on a status the review screen can explain.
 */
async function extractOne(
  supabase: SupabaseClient,
  userId: string,
  uploadId: string
): Promise<ExtractOutcome> {
  const { data: row } = await supabase
    .from("invoice_uploads")
    .select("*")
    .eq("id", uploadId)
    // Explicit scoping: the service client bypasses RLS (R3 exception).
    .eq("user_id", userId)
    .single();

  if (!row) {
    return { upload_id: uploadId, status: "failed", error: "Upload row vanished." };
  }
  const upload = row as InvoiceUpload;

  // Same guard as the extract route: a committed upload is finished with.
  if (upload.status === "committed") {
    return { upload_id: uploadId, status: "extracted", error: null };
  }

  await supabase
    .from("invoice_uploads")
    .update({ status: "processing", error: null })
    .eq("id", upload.id)
    .eq("user_id", userId);

  for (let attempt = 0; ; attempt++) {
    try {
      const { data: file, error: dlError } = await supabase.storage
        .from("invoices")
        .download(upload.storage_path);
      if (dlError || !file)
        throw new ExtractionError(
          `Could not read the uploaded file from storage: ${dlError?.message ?? "not found"}`
        );

      const bytes = new Uint8Array(await file.arrayBuffer());
      const { extraction: raw, method, page_count } = await extractInvoice(
        bytes,
        upload.mime_type ?? ""
      );

      // extraction_raw is evidence, not a contract (types/index.ts) — re-check
      // it here exactly as the extract route does before anything trusts it.
      const parsed = InvoiceExtractionSchema.safeParse(raw);
      if (!parsed.success)
        throw new ExtractionError(
          `The extraction did not match the expected shape: ${parsed.error.message}`
        );

      const { error: updateError } = await supabase
        .from("invoice_uploads")
        .update({
          status: "extracted",
          extraction_raw: parsed.data,
          extraction_method: method,
          page_count,
          error: null,
        })
        .eq("id", upload.id)
        .eq("user_id", userId);
      if (updateError) throw new ExtractionError(updateError.message);

      return { upload_id: uploadId, status: "extracted", error: null };
    } catch (e) {
      const throttled = isRateLimited(e);

      if (throttled && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }

      const detail =
        e instanceof Error ? e.message : "Extraction failed for an unknown reason.";

      if (throttled) {
        // Back to 'pending', not 'failed'. Nothing is wrong with the document;
        // the next drain tick, or the Extract button on the review screen, will
        // read it. The prefix is what makes that legible on screen.
        const message = `${RATE_LIMIT_PREFIX} — this invoice has not been read yet and will be retried automatically. (${detail})`;
        await supabase
          .from("invoice_uploads")
          .update({ status: "pending", error: message })
          .eq("id", upload.id)
          .eq("user_id", userId);
        return { upload_id: uploadId, status: "pending", error: message };
      }

      await supabase
        .from("invoice_uploads")
        .update({ status: "failed", error: detail })
        .eq("id", upload.id)
        .eq("user_id", userId);
      return { upload_id: uploadId, status: "failed", error: detail };
    }
  }
}

/**
 * Extract a batch of uploads, at most CONCURRENCY at a time.
 *
 * A plain worker pool rather than Promise.all: firing ten Gemini calls at once
 * guarantees the 429 this is trying to avoid, and the drain has a time budget
 * to respect.
 */
export async function extractQueued(
  supabase: SupabaseClient,
  userId: string,
  uploadIds: string[]
): Promise<ExtractOutcome[]> {
  const queue = [...uploadIds];
  const outcomes: ExtractOutcome[] = [];

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      outcomes.push(await extractOne(supabase, userId, next));
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)
  );
  return outcomes;
}
