import type { PurchaseTotals } from "@/types";

/**
 * One combined gross / paid / balance for a whole screen.
 *
 * `lib/` still splits every figure by `entry_source`, and must keep doing so:
 * that split is the only thing standing between the app and a double-count on
 * the day a second dataset is imported alongside the invoices (about.md §5).
 *
 * What changed is what the *screens* say about it. "Diary" and "ledger" were
 * labels off the retired Excel import; the ledger has been empty since
 * migration 0009, so every one of these screens was showing a reader a split
 * with only one side to it, plus a note explaining why the two halves must
 * never be added — when there was only ever one half. So the split survives in
 * the data and is added up here, at the last possible moment, for display.
 *
 * Returns null for an empty list, so a caller can tell "nothing to show" from
 * "everything is zero".
 */
export function combineTotals(
  totals: PurchaseTotals[]
): Omit<PurchaseTotals, "entry_source"> | null {
  if (totals.length === 0) return null;
  const combined = totals.reduce(
    (acc, t) => ({
      purchase_count: acc.purchase_count + t.purchase_count,
      gross: acc.gross + t.gross,
      paid: acc.paid + t.paid,
      balance: acc.balance + t.balance,
    }),
    { purchase_count: 0, gross: 0, paid: 0, balance: 0 }
  );
  // Recomputed rather than summed, so it can never disagree with the two
  // figures printed beside it.
  combined.balance = combined.gross - combined.paid;
  return combined;
}
