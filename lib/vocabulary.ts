/**
 * The money vocabulary — four words, one meaning each, used on every screen.
 *
 * Before this existed the same figure was called a different thing depending on
 * which screen you were on: `total_incl_vat` was "Actual" on the Expenses tab,
 * "Actual Total" on Overview, "Gross" on the invoice list, "Total" on Trades,
 * "Invoiced" on the invoice banner, "Total spend" on Suppliers and "Spent" on
 * the Dashboard. `total − paid` was "Remaining", "Balance", "Outstanding" and
 * "Owed" in four different places. A reader had no way to know those were the
 * same number, so every screen read as a new set of figures to reconcile.
 *
 * The rule now: a screen showing one of these four quantities uses this label
 * for it, and nothing else uses these labels. If a new screen needs a fifth
 * word, that is a sign it is showing a fifth quantity — say so explicitly
 * rather than inventing a synonym for one of these.
 *
 * These are display labels only. They deliberately do NOT match the column and
 * field names (`quoted_amount`, `total_incl_vat`, `gross_total`, `balance`),
 * which stay as they are: this is what the reader is told, not what the
 * database calls it.
 */

export interface MoneyTerm {
  /** What the reader sees. */
  label: string;
  /** One line saying what it counts — for a StatCard hint or a title tooltip. */
  hint: string;
}

export const MONEY = {
  /** `quoted_amount` — the price agreed before the money went out. */
  committed: {
    label: "Committed",
    hint: "Agreed or quoted, incl VAT",
  },
  /** `total_incl_vat` / `gross_total` — what it actually cost. */
  cost: {
    label: "Cost",
    hint: "Actual, incl VAT",
  },
  /** `paid_amount` / payments — money that has actually left. */
  paid: {
    label: "Paid",
    hint: "Handed over so far",
  },
  /** `remaining` / `balance` — cost minus paid. */
  owed: {
    label: "Owed",
    hint: "Cost minus Paid",
  },
} as const satisfies Record<string, MoneyTerm>;

/**
 * Budget is not one of the four. It is a target set on the project rather than
 * a figure derived from what has been spent, and it lives here so the word is
 * used consistently too.
 */
export const BUDGET: MoneyTerm = {
  label: "Budget",
  hint: "Target set for this project",
};
