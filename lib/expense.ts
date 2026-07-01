// Shared helper to normalise an expense form/body into a DB payload.
const NUMERIC = [
  "quoted_amount",
  "actual_amount",
  "paid_amount",
  "qty",
  "unit_cost",
  "vat_rate",
];

export function buildExpensePayload(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {
    week_number: Number(body.week_number),
    description: String(body.description ?? "").trim(),
    category: body.category || null,
    trade: body.trade || null,
    location_room: body.location_room || null,
    notes: body.notes || null,
    supplier: body.supplier || null,
    invoice_ref: body.invoice_ref || null,
    paid_date: body.paid_date || null,
    payment_method: body.payment_method || null,
    status: body.status || "Planned",
  };
  for (const k of NUMERIC) out[k] = Number(body[k] ?? 0);
  return out;
}
