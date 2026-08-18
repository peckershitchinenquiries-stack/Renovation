// Cleaning up what came off the page, before anything tries to match it.
//
// The extractor transcribes; this decides what the transcription *is*. Every
// function here is pure, has no database access, and is used identically on
// the server and in the review screen — so what the browser previews is what
// the server saves.
//
// The two normalisers below must stay in step with their database twins:
//
//   normaliseName()  ↔ public.norm_key()   (lib/purchases.ts — reused, not
//                                           reimplemented, on purpose)
//   normaliseVat()   ↔ public.norm_vat()   (migration 0010)
//
// If they drift, the browser and the database disagree about what one
// merchant is, and the unique index starts rejecting saves the form said were
// fine.

import { normaliseName, round2 } from "@/lib/purchases";
import { isVatRate, type ExpenseCategory, type PaymentMethod, type VatRate } from "@/types";
import type { InvoiceExtraction, InvoiceLine } from "@/lib/invoice/schema";

export { normaliseName };

// The values purchase_lines.vat_rate will accept — 0, 5 or 20 since migration
// 0011. Re-exported so the rest of lib/invoice keeps importing it from here,
// but there is one definition of the list, in types/index.ts, next to the
// constant the form's dropdown is built from.
export type { VatRate };

/**
 * A VAT number reduced to its comparable form: alphanumerics only,
 * upper-cased. Exactly public.norm_vat() in migration 0010.
 *
 * The country prefix is deliberately kept. Two countries can issue the same
 * digits, and treating 'GB123456789' and 'IE123456789' as one merchant would
 * merge two real companies — the one mistake this whole mechanism exists to
 * prevent.
 */
export function normaliseVat(value: string | null | undefined): string | null {
  const cleaned = String(value ?? "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  return cleaned === "" ? null : cleaned;
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? null : trimmed;
};

/**
 * An ISO date, or null.
 *
 * `purchases.purchase_date` is a real `date` column: free text cannot go in
 * it, and this project has been bitten by that before — the source
 * spreadsheets contain things like `Friday 27/2` (about.md §3.1). Anything
 * that is not unambiguously yyyy-mm-dd, and does not describe a real day,
 * becomes null and the review screen asks for it.
 */
export function normaliseDate(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Rejects 2026-02-31, which Date would otherwise roll forward into March.
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() + 1 !== Number(m) ||
    date.getUTCDate() !== Number(d)
  )
    return null;
  return `${y}-${m}-${d}`;
}

/**
 * The VAT rate the document printed, or null.
 *
 * **The rate the invoice states is the rate that gets kept.** `vat_rate` used
 * to be narrowed to 0 or 20 here, which meant a reduced-rate (5%) invoice —
 * ordinary on residential renovation work — arrived at the review screen with
 * its rate thrown away and the field defaulted to 0%, and its VAT quietly
 * disappeared from every total. Migration 0011 widened the CHECK to 0/5/20 and
 * this now passes all three straight through.
 *
 * A rate outside that set (a historic 17.5%, or a misread figure) still
 * becomes null rather than being coerced: the CHECK rejects rather than
 * coerces (about.md §2 rule 4), so the review screen shows an *empty* rate
 * that has to be chosen, and documentNotes() in reconcile.ts says which rate
 * was read and could not be stored.
 */
export function normaliseVatRate(
  value: number | null | undefined
): VatRate | null {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
  // 20.00 and "20" both arrive as 20; a rate is never a fraction of a percent.
  const rate = round2(value);
  return isVatRate(rate) ? (rate as VatRate) : null;
}

/** A non-negative money figure to the penny, or null. */
export function normaliseMoney(
  value: number | null | undefined
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
  return round2(value);
}

const METHODS: PaymentMethod[] = [
  "Cash",
  "Debit Card",
  "Credit Card",
  "Bank Transfer",
];

/**
 * Map whatever the document called the payment onto the four the schema
 * allows, or null. "Visa", "chip and pin" and "card" are all a debit card as
 * far as this app is concerned, and guessing between debit and credit off a
 * receipt is not something a human could do either.
 */
export function normalisePaymentMethod(
  value: string | null | undefined
): PaymentMethod | null {
  const raw = (text(value) ?? "").toLowerCase();
  if (!raw) return null;
  const exact = METHODS.find((m) => m.toLowerCase() === raw);
  if (exact) return exact;
  if (/\bcash\b/.test(raw)) return "Cash";
  if (/credit/.test(raw)) return "Credit Card";
  if (/debit|visa|maestro|contactless|chip|card/.test(raw)) return "Debit Card";
  if (/bacs|transfer|bank|faster payment|standing order/.test(raw))
    return "Bank Transfer";
  return null;
}

/**
 * A best-guess category for the document as a whole.
 *
 * `purchases.category` is one of four values and drives the Materials split
 * everywhere else. A merchant invoice is Materials far more often than not,
 * but this only ever *suggests* — the review screen shows a dropdown, and
 * the guess is a starting point, not a decision.
 */
export function guessCategory(
  extraction: InvoiceExtraction
): ExpenseCategory | null {
  const haystack = [
    extraction.supplier_name,
    ...extraction.lines.map((l) => l.description),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return null;
  if (/\bskip\b|waste|disposal|muck away|grab hire/.test(haystack))
    return "Skip/Disposal";
  if (/labour|day ?rate|fitting|installation charge|site visit/.test(haystack))
    return "Labour";
  return "Materials";
}

/** A quantity to the thousandth, or null. `purchase_lines.qty` is numeric(12,3). */
const normaliseQty = (value: number | null | undefined): number | null =>
  value === null || value === undefined || !Number.isFinite(value) || value < 0
    ? null
    : Math.round(value * 1000) / 1000;

// A quantity jammed onto the front of a unit code: "10.000EA", "5 EA",
// "2BAG", "1,000M". Merchant invoices print the quantity column exactly like
// this, and once the PDF's layout is lost the pair arrives as one token.
const QTY_STUCK_TO_UNIT = /^([0-9]+(?:[.,][0-9]+)?)\s*(.*)$/;

/**
 * Pull the quantity out of the unit when the document ran the two together.
 *
 * The bug this exists for: a line printed as `10.000EA` came back as
 * qty = null, unit = "EA" — the number, which is the whole point of the
 * column, was dropped on the floor, and the review screen showed an empty Qty
 * against a unit of "EA". The prompt asks for them split (lib/invoice/prompt.ts,
 * "qty"), but asking is not a guarantee, and this is cheap and exact.
 *
 * Two rules keep it honest:
 *
 *  • A leading number is only *taken as* the quantity when no quantity was
 *    read at all. If the extractor already gave one, it wins.
 *  • The number is only *stripped from* the unit when it is unclaimed, or when
 *    it is the quantity repeated. A genuine unit like "2.4m" (a length, not a
 *    count) survives untouched next to its own qty of 10.
 */
export function splitQtyFromUnit(
  qty: number | null,
  unit: string | null
): { qty: number | null; unit: string | null } {
  const raw = text(unit);
  if (!raw) return { qty, unit: null };

  const match = QTY_STUCK_TO_UNIT.exec(raw);
  if (!match) return { qty, unit: raw };

  const leading = normaliseQty(Number(match[1].replace(",", "")));
  const rest = text(match[2]);
  if (leading === null) return { qty, unit: raw };

  // No quantity was read: this number is it, and what follows is the unit.
  // "10.000EA" -> qty 10, unit "EA". "12" alone -> qty 12, no unit.
  if (qty === null) return { qty: leading, unit: rest };
  // The quantity written twice — keep the one already read and drop the
  // duplicate, so the Unit field says "EA" rather than "10.000EA".
  if (Math.abs(leading - qty) < 0.0005) return { qty, unit: rest };
  // Two different numbers: this is a unit that genuinely starts with one
  // ("2.4m"). Leave it exactly as the document printed it.
  return { qty, unit: raw };
}

/**
 * One extracted line, cleaned into the shape the invoice form holds.
 *
 * `line_net` is kept as the document stated it and is NOT recomputed from
 * qty × unit_price: invoices carry discounts and part-loads, and the
 * disagreement between the two is a warning the form already renders
 * (lineArithmeticGap, about.md §10.1). Recomputing here would erase it.
 *
 * `qty` is the one exception, and only as a last resort — see below.
 */
export function normaliseLine(line: InvoiceLine): {
  description_raw: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_net: number | null;
  vat_rate: VatRate | null;
} {
  const unit_price =
    line.unit_price !== null && Number.isFinite(line.unit_price)
      ? Math.round(line.unit_price * 10000) / 10000
      : null;
  const line_net = normaliseMoney(line.line_net);

  let { qty, unit } = splitQtyFromUnit(normaliseQty(line.qty), line.unit);

  // Still no quantity, but the document printed a unit price and a line total.
  // The quantity that reconciles them is arithmetic the invoice itself
  // asserts, so it is filled in — under two conditions, both needed:
  //
  //   • it multiplies back to the printed line total, to the penny; and
  //   • it is a whole number.
  //
  // The second is what keeps this honest. A discounted line divides "exactly"
  // too — £47.30 at £12.50 each comes out at 3.784, which multiplies straight
  // back and is nonsense. Real merchant quantities that go unread are counts;
  // anything fractional is far more likely to be a discount, a part-load or a
  // carriage charge, and those are left blank for a human. A missing qty is a
  // gap you can see. A fabricated one is a wrong number in a field nobody
  // looks at twice.
  if (qty === null && unit_price !== null && unit_price > 0 && line_net) {
    // Rounded first and checked after, rather than tested for integer-ness:
    // 32 / 3.2 is 10.000000000000002 in binary floating point, and a real
    // ten-of-something must not be lost to that.
    const derived = Math.round(line_net / unit_price);
    if (derived >= 1 && Math.abs(round2(derived * unit_price) - line_net) <= 0.005)
      qty = derived;
  }

  return {
    description_raw: text(line.description) ?? "",
    qty,
    unit,
    unit_price,
    line_net,
    vat_rate: normaliseVatRate(line.vat_rate),
  };
}

/** Everything above, applied to a whole extraction in one pass. */
export function normaliseExtraction(extraction: InvoiceExtraction) {
  return {
    supplier_name: text(extraction.supplier_name),
    supplier_vat_number: normaliseVat(extraction.supplier_vat_number),
    supplier_address: text(extraction.supplier_address),
    invoice_no: text(extraction.invoice_no),
    invoice_date: normaliseDate(extraction.invoice_date),
    document_type: text(extraction.document_type),
    currency: text(extraction.currency)?.toUpperCase() ?? null,
    net_total: normaliseMoney(extraction.net_total),
    vat_total: normaliseMoney(extraction.vat_total),
    gross_total: normaliseMoney(extraction.gross_total),
    amount_paid: normaliseMoney(extraction.amount_paid),
    payment_method: normalisePaymentMethod(extraction.payment_method),
    category: guessCategory(extraction),
    notes: text(extraction.notes),
    // A line with no description at all is not a line — it is a blank row the
    // extractor could not read, and description_raw is NOT NULL.
    lines: extraction.lines
      .map(normaliseLine)
      .filter((l) => l.description_raw !== ""),
  };
}

export type NormalisedExtraction = ReturnType<typeof normaliseExtraction>;
