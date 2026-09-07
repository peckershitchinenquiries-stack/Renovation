import { requireUser, json, error } from "@/lib/api";
import { recordReceipt } from "@/lib/purchaseOrderWrite";

interface ReceiptBody {
  lines?: { line_id?: string; qty_received?: number | string }[];
}

/**
 * Record what actually turned up (migration 0023).
 *
 * A route of its own rather than a field on the edit form, because marking a
 * delivery is something somebody does standing in a yard on a phone. Making
 * them open the full order — with its supplier, prices and VAT rates all
 * editable — to type one number is how a wrong price gets saved by accident.
 *
 * The order's status follows the quantities rather than being sent: an order
 * whose lines have all arrived IS received, and letting the two disagree makes
 * the status worthless. Over-delivery is recorded, never refused — ordering 40
 * and taking 48 is a real thing that happens, and the point of the table is
 * that it becomes visible instead of being absorbed.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string; poId: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as ReceiptBody;
  const lines = (body.lines ?? []).filter(
    (l): l is { line_id: string; qty_received: number | string } =>
      Boolean(l.line_id) && l.qty_received !== undefined
  );
  if (lines.length === 0) return error("Nothing to record", 400);

  const invalid = lines.find(
    (l) => !Number.isFinite(Number(l.qty_received)) || Number(l.qty_received) < 0
  );
  if (invalid)
    return error("Quantities must be non-negative numbers", 422, {
      qty_received: "Must be non-negative",
    });

  // Proves the order is on the project in the route, so an id from another job
  // is a 404 rather than a cross-project write.
  const { data: order } = await auth.supabase
    .from("purchase_orders")
    .select("id")
    .eq("id", params.poId)
    .eq("project_id", params.id)
    .single();
  if (!order) return error("Order not found", 404);

  try {
    await recordReceipt(auth.supabase, params.poId, lines);
    return json({ ok: true });
  } catch (e) {
    return error(
      e instanceof Error ? e.message : "Could not record the delivery",
      500
    );
  }
}
