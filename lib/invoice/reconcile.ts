// Checking an extraction against itself.
//
// An invoice carries its own checksum: the lines add up to the subtotal, the
// VAT is a percentage of it, and the two make the total. When they disagree,
// exactly one of two things has happened — a figure was mis-read, or the
// document genuinely does something unusual (a settlement discount, a
// rounding line, a part-credit). Both are worth a human's eye and neither is
// worth blocking a save over.
//
// **Everything here is a warning. Nothing here rejects.** A real invoice is
// allowed to be odd, and an extractor that refuses odd documents is an
// extractor nobody uses. This mirrors §10.1: the expense form's four
// advisories never block a save either.
//
// The warnings come back in the shape PurchaseForm already renders —
// { expected, stated } pairs, exactly like lineArithmeticGap in
// lib/purchases.ts — so the review screen shows the same boxes, in the same
// words, as typing the invoice in by hand would have done.

import { round2 } from "@/lib/purchases";
import { VAT_RATES_SENTENCE, isVatRate } from "@/types";
import type { InvoiceExtraction } from "@/lib/invoice/schema";

// Two pence of slack.
//
// Wider than the penny LINE_ARITHMETIC_TOLERANCE uses, and deliberately:
// these are document-level sums over N lines, so N per-line roundings
// accumulate here. A real invoice is out by a penny surprisingly often; two
// pence still catches a transposed digit, which is what this is for.
export const RECONCILE_TOLERANCE = 0.02;

export interface ReconcileWarning {
  // Which of the three checks failed. The review screen keys its wording off
  // this rather than off the message, so the copy stays in the component.
  check: "lines_vs_net" | "vat_vs_lines" | "net_plus_vat_vs_gross";
  // What the figures say it should be, and what the document printed.
  expected: number;
  stated: number;
  // stated − expected. Positive means the document claims more than the
  // lines account for, which usually means a line was missed.
  gap: number;
  message: string;
}

const money = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP" });

// Σ over the lines, ignoring the ones the extractor could not read a figure
// off. A null is "not readable", not "zero" — but for these sums the two
// behave the same, and the missing line shows up as a gap, which is the
// point.
function lineTotals(extraction: InvoiceExtraction): {
  net: number;
  vat: number;
  priced_lines: number;
} {
  let net = 0;
  let vat = 0;
  let priced_lines = 0;
  for (const line of extraction.lines) {
    if (line.line_net === null || !Number.isFinite(line.line_net)) continue;
    const lineNet = round2(line.line_net);
    net += lineNet;
    // VAT rounded per line and then added — the same order migration 0008's
    // backfill and purchaseTotalsFromLines use, so an invoice read here and
    // one typed in by hand carry the same pennies.
    vat += round2((lineNet * (line.vat_rate ?? 0)) / 100);
    priced_lines += 1;
  }
  return { net: round2(net), vat: round2(vat), priced_lines };
}

/**
 * The three checks.
 *
 * Each one is skipped when the document did not print the figure it needs —
 * plenty of receipts state only a grand total, and "the subtotal is missing"
 * is not a discrepancy.
 */
export function reconcile(extraction: InvoiceExtraction): ReconcileWarning[] {
  const warnings: ReconcileWarning[] = [];
  const { net, vat, priced_lines } = lineTotals(extraction);

  // Nothing to reconcile against. Say nothing rather than warn about every
  // figure being absent — the review screen already shows the empty fields.
  if (priced_lines === 0) return warnings;

  const push = (
    check: ReconcileWarning["check"],
    expected: number,
    stated: number,
    message: (gap: number) => string
  ) => {
    const gap = round2(stated - expected);
    if (Math.abs(gap) <= RECONCILE_TOLERANCE) return;
    warnings.push({ check, expected, stated, gap, message: message(gap) });
  };

  // 1. Do the lines add up to the printed subtotal?
  if (extraction.net_total !== null && Number.isFinite(extraction.net_total)) {
    push("lines_vs_net", net, round2(extraction.net_total), (gap) =>
      `The ${priced_lines} ${priced_lines === 1 ? "line adds" : "lines add"} up to ${money(
        net
      )} ex VAT, but the invoice prints ${money(round2(extraction.net_total!))} — ${money(
        Math.abs(gap)
      )} ${gap > 0 ? "unaccounted for, so a line is probably missing" : "too much, so a line may be double-counted"}.`
    );
  }

  // 2. Is the printed VAT the VAT on those lines?
  if (extraction.vat_total !== null && Number.isFinite(extraction.vat_total)) {
    push("vat_vs_lines", vat, round2(extraction.vat_total), (gap) =>
      `VAT on the lines comes to ${money(vat)}, but the invoice prints ${money(
        round2(extraction.vat_total!)
      )} — a difference of ${money(Math.abs(gap))}. Check the rate on each line.`
    );
  }

  // 3. Does the printed grand total equal its own printed parts?
  //    Uses the document's own net and VAT where it printed them, falling
  //    back to the lines — otherwise this would just repeat check 1.
  if (extraction.gross_total !== null && Number.isFinite(extraction.gross_total)) {
    const expectedNet = extraction.net_total ?? net;
    const expectedVat = extraction.vat_total ?? vat;
    push(
      "net_plus_vat_vs_gross",
      round2(round2(expectedNet) + round2(expectedVat)),
      round2(extraction.gross_total),
      (gap) =>
        `${money(round2(expectedNet))} plus ${money(
          round2(expectedVat)
        )} VAT is ${money(round2(round2(expectedNet) + round2(expectedVat)))}, but the invoice total says ${money(
          round2(extraction.gross_total!)
        )} — out by ${money(Math.abs(gap))}.`
    );
  }

  return warnings;
}

// ============================================================
// Things that are not arithmetic but still want saying
// ============================================================

/**
 * Advisories about the document itself, in the same shape as the arithmetic
 * ones so the review screen has a single list to render.
 *
 * These are the "this may not be what you think it is" checks: a quote is not
 * a purchase, a foreign currency does not convert, and a VAT rate the
 * database will reject is better caught here than at the insert.
 */
export function documentNotes(extraction: InvoiceExtraction): string[] {
  const notes: string[] = [];

  const kind = (extraction.document_type ?? "").trim().toLowerCase();
  if (kind && !["invoice", "receipt", "bill", "credit note"].includes(kind))
    notes.push(
      `This looks like a ${kind}, not an invoice. Log it only if money has genuinely been committed.`
    );

  const currency = (extraction.currency ?? "").trim().toUpperCase();
  if (currency && currency !== "GBP")
    notes.push(
      `The document is in ${currency}. Every figure in RenovaTrack is sterling and nothing is converted — enter the amounts in pounds.`
    );

  // vat_rate is a CHECK constraint on purchase_lines — 0, 5 or 20 since
  // migration 0011 — and it rejects rather than coerces (about.md §2 rule 4).
  // Whatever the document printed is kept as long as the constraint takes it;
  // this note is only for the rates it will not, so the review screen can ask
  // for a decision instead of the save failing. Those lines reach the form with
  // an empty VAT field, which validation then insists on.
  const oddRates = [
    ...new Set(
      extraction.lines
        .map((l) => l.vat_rate)
        .filter(
          (r): r is number => r !== null && Number.isFinite(r) && !isVatRate(r)
        )
    ),
  ];
  if (oddRates.length > 0)
    notes.push(
      `VAT can only be saved as ${VAT_RATES_SENTENCE}% — the ${
        oddRates.length === 1 ? "rate" : "rates"
      } ${oddRates.map((r) => `${r}%`).join(", ")} read off this document cannot be stored, so the VAT box on ${
        oddRates.length === 1 ? "that line" : "those lines"
      } has been left empty. Pick the right rate before saving.`
    );

  const undated = extraction.lines.filter((l) => l.line_net === null).length;
  if (undated > 0)
    notes.push(
      `${undated} ${
        undated === 1 ? "line has" : "lines have"
      } no readable amount. Type the missing ${
        undated === 1 ? "figure" : "figures"
      } in, or remove the ${undated === 1 ? "line" : "lines"}.`
    );

  return notes;
}
