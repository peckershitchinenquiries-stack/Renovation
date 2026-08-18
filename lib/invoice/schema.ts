// What we ask the extractor to give back for one invoice.
//
// **Every field is nullable, and that is the single most important thing about
// this file.** A photographed invoice is frequently creased, cropped, or
// missing the bit you wanted. A schema that demanded a VAT number would get
// one invented; a schema that demands nothing gets a truthful null, and the
// review screen can then say "the invoice number could not be read" instead of
// showing a plausible-looking wrong one.
//
// The numbers are all plain `number` for the same reason: constraints like
// minimum/maximum are not supported by structured outputs (they are stripped
// and validated client-side), and a rejected extraction is worse than an odd
// one we can show a human. Sanity checking is reconcile.ts's job, and it only
// ever warns.

import * as z from "zod";

export const InvoiceLineSchema = z.object({
  // As written on the document, verbatim — this becomes purchase_lines.description_raw.
  description: z.string().nullable(),
  qty: z.number().nullable(),
  // The unit as printed: "each", "bag", "m2", "tonne". Never guessed — a
  // wrong unit turns a price comparison into a lie (about.md §8.1).
  unit: z.string().nullable(),
  // Price per unit, ex-VAT.
  unit_price: z.number().nullable(),
  // Line total, ex-VAT.
  line_net: z.number().nullable(),
  // UK VAT: 0 or 20. Anything else is reported as read and flagged later —
  // the database CHECK would reject it, so it must not be silently coerced.
  vat_rate: z.number().nullable(),
});

export const InvoiceExtractionSchema = z.object({
  // ---- who ----
  supplier_name: z.string().nullable(),
  // The only hard identifier on the page. Worth more than the name.
  supplier_vat_number: z.string().nullable(),
  supplier_address: z.string().nullable(),

  // ---- which document ----
  invoice_no: z.string().nullable(),
  // ISO yyyy-mm-dd. Null rather than a guess when the printed date is
  // ambiguous — `paid_date` in this project is a real date column and free
  // text cannot go in it (about.md §4.2).
  invoice_date: z.string().nullable(),
  // 'invoice' | 'receipt' | 'delivery note' | 'quote' | 'statement' | …
  // A quote is not a purchase, and the review screen says so.
  document_type: z.string().nullable(),
  // ISO 4217 as printed. Anything other than GBP is flagged: every figure in
  // this app is sterling and nothing converts.
  currency: z.string().nullable(),

  // ---- money, as the document states it ----
  // Stated, not computed. reconcile.ts checks these against the lines; that
  // check is the whole reason we ask for them separately.
  net_total: z.number().nullable(),
  vat_total: z.number().nullable(),
  gross_total: z.number().nullable(),

  // ---- what has already been handed over ----
  // Only when the document says so ("PAID", a card receipt, a deposit line).
  amount_paid: z.number().nullable(),
  payment_method: z.string().nullable(),

  // ---- the lines ----
  lines: z.array(InvoiceLineSchema),

  // Anything on the page that mattered and had nowhere else to go — a
  // delivery reference, a discount note, "pay within 30 days".
  notes: z.string().nullable(),
});

export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

/**
 * Read a stored `extraction_raw` back into the typed shape.
 *
 * `invoice_uploads.extraction_raw` is jsonb and is deliberately never trusted:
 * it is evidence of what came back, not a contract. Anything that fails to
 * parse returns null, and the review screen shows the failure rather than
 * crashing on a missing field.
 */
export function parseExtraction(raw: unknown): InvoiceExtraction | null {
  const parsed = InvoiceExtractionSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
