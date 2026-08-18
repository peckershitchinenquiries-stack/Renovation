import { requireUser, json, error } from "@/lib/api";
import { validatePurchase, hasErrors } from "@/lib/validation";
import { createPurchase } from "@/lib/purchaseWrite";
import type { PurchaseInput } from "@/types";

// Log a multi-line invoice against a project: one purchase, N lines, and any
// payments already made against it. Suppliers and items that have never been
// seen are created as a side effect — see lib/purchaseWrite.ts.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => ({}));
  const errors = validatePurchase(body);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // RLS enforces ownership too; this turns "not yours" into a 404 rather than
  // a foreign-key failure.
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", params.id)
    .single();
  if (!project) return error("Project not found", 404);

  try {
    const purchase = await createPurchase(
      auth.supabase,
      auth.user.id,
      params.id,
      body as PurchaseInput
    );
    return json(purchase, 201);
  } catch (e) {
    return error(e instanceof Error ? e.message : "Could not save the invoice", 500);
  }
}
