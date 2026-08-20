// Display helpers shared by the project tabs.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a stored 'YYYY-MM-DD' date without timezone drift.
 *
 * Deliberately string surgery rather than `new Date(...)`: a bare date string
 * is parsed as UTC and then rendered in local time, which turns 1 March into
 * 28 February for anyone west of Greenwich. These are dates off invoices, not
 * instants, so they are never converted.
 */
export function fmtDate(d: string | null): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${Number(day)} ${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

/** "3 bags" / "3" when the document recorded no unit. */
export function fmtQty(qty: number, unit: string | null): string {
  if (!qty) return "—";
  const n = Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
  return unit?.trim() ? `${n} ${unit.trim()}` : n;
}

/** "£12.50 / bag" — a unit price is meaningless without the unit it is per. */
export function fmtUnitPrice(price: number, unit: string | null): string {
  if (!(price > 0)) return "—";
  const money = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    // Trade prices carry more than two decimals often enough to matter —
    // £0.4125 a brick is a real price, and rounding it to £0.41 moves a
    // 10,000-brick order by £150.
    maximumFractionDigits: 4,
  }).format(price);
  return unit?.trim() ? `${money} / ${unit.trim()}` : money;
}
