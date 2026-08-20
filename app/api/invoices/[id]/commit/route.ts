import { requireUser, json, error } from "@/lib/api";
import { validatePurchase, hasErrors } from "@/lib/validation";
import { createPurchase } from "@/lib/purchaseWrite";
import { normaliseName } from "@/lib/purchases";
import type { InvoiceUpload, PurchaseInput } from "@/types";

// Postgres unique_violation — someone already recorded this exact alias.
// Harmless: the row already says what we were about to say.
const UNIQUE_VIOLATION = "23505";

// What the review screen decided about the supplier, alongside the reviewed
// (and possibly hand-edited) purchase itself. `raw_alias` is always the raw
// string as it appeared on the invoice, never the edited name — the alias
// exists to match the *next* invoice, which will carry the raw string again.
interface SupplierDecision {
  // 'existing' — the user confirmed one of lib/invoice/resolve.ts's
  //              candidates (certain, likely or possible).
  // 'new'      — the user accepted (or edited) the newSupplierDraft.
  // 'manual'   — the user typed a supplier by hand, bypassing resolution
  //              entirely. Falls through to the same behaviour the manual
  //              purchase form already has: exact-match-or-create, no alias
  //              bookkeeping beyond what createPurchase already does.
  mode: "existing" | "new" | "manual";
  supplier_id?: string | null;
  name?: string | null;
  vat_number?: string | null;
  address?: string | null;
  raw_alias?: string | null;
}

interface CommitBody {
  purchase: PurchaseInput;
  supplier?: SupplierDecision | null;
  // Which project to file this invoice against, chosen on the review screen.
  // Optional only for an upload that already carries one (the in-project flow
  // that predates migration 0012); one of the two must be present.
  project_id?: string | null;
}

// Step 3: write the reviewed invoice into `purchases`.
//
// This never inserts a header or a line itself — createPurchase in
// lib/purchaseWrite.ts does that, exactly the way the manual multi-line form
// does, so there is exactly one place that turns a PurchaseInput into rows.
// What this route adds on top is invoice-specific provenance createPurchase
// doesn't know about: a supplier chosen from a resolver match gets the raw
// invoice string remembered as an alias, and a brand-new supplier gets
// flagged `is_unverified` with `created_from_upload_id` set.
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: uploadRow } = await auth.supabase
    .from("invoice_uploads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!uploadRow) return error("Upload not found", 404);
  const upload = uploadRow as InvoiceUpload;

  if (upload.status === "committed")
    return error("This upload has already been committed to a purchase.", 409);

  const body = (await req.json().catch(() => null)) as CommitBody | null;
  if (!body?.purchase) return error("Missing purchase payload", 400);

  const errors = validatePurchase(
    body.purchase as unknown as Record<string, unknown>
  );
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  // Where this invoice gets filed. The review screen's Project field wins over
  // whatever the upload was created with, so changing your mind on the review
  // screen actually moves it; the upload's own project_id is the fallback for
  // an upload that was started inside a project.
  const projectId = body.project_id?.trim() || upload.project_id;
  if (!projectId)
    return error("Choose a project for this invoice before saving.", 400, {
      project_id: "Choose a project",
    });

  // RLS-backed: another user's project reads as absent, so this is a 404 and
  // never a foreign-key error halfway through createPurchase.
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();
  if (!project) return error("Project not found", 404);

  const decision = body.supplier ?? null;

  let supplierName = body.purchase.supplier_name;
  // True only when the "new supplier" being accepted genuinely does not
  // exist yet — checked before createPurchase runs, because afterwards
  // there is no way to tell "just created" from "already existed" apart.
  let markUnverified = false;

  if (decision?.mode === "existing") {
    if (!decision.supplier_id)
      return error("supplier.supplier_id is required for mode 'existing'", 400);
    const { data: existing } = await auth.supabase
      .from("suppliers")
      .select("id, name")
      .eq("id", decision.supplier_id)
      .single();
    if (!existing) return error("Chosen supplier not found", 404);
    // Passing the supplier's own canonical name makes createPurchase's exact
    // matcher land on this exact row — ux_suppliers_user_name guarantees no
    // other supplier normalises to the same key (migration 0008).
    supplierName = existing.name;
  } else if (decision?.mode === "new") {
    const name = (decision.name ?? "").trim();
    if (!name)
      return error("supplier.name is required for mode 'new'", 400);
    const key = normaliseName(name);
    const { data: allSuppliers } = await auth.supabase
      .from("suppliers")
      .select("name");
    markUnverified = !((allSuppliers ?? []) as { name: string }[]).some(
      (s) => normaliseName(s.name) === key
    );
    supplierName = name;
  }

  const finalInput: PurchaseInput = { ...body.purchase, supplier_name: supplierName };

  let purchase;
  try {
    purchase = await createPurchase(
      auth.supabase,
      auth.user.id,
      projectId,
      finalInput
    );
  } catch (e) {
    return error(e instanceof Error ? e.message : "Could not save the invoice", 500);
  }

  if (purchase.supplier_id && decision?.mode === "new" && markUnverified) {
    await auth.supabase
      .from("suppliers")
      .update({
        is_unverified: true,
        created_from_upload_id: upload.id,
        vat_number: decision.vat_number ?? null,
        address: decision.address ?? null,
      })
      .eq("id", purchase.supplier_id);
  }

  // Always write an alias for the raw string off the invoice, whichever
  // branch the supplier came from — this is what lets the next invoice from
  // the same merchant resolve at 'certain' without asking again.
  if (purchase.supplier_id && decision?.raw_alias?.trim()) {
    const { error: aliasError } = await auth.supabase.from("supplier_aliases").insert({
      user_id: auth.user.id,
      supplier_id: purchase.supplier_id,
      alias: decision.raw_alias.trim(),
    });
    if (aliasError && aliasError.code !== UNIQUE_VIOLATION) {
      // The purchase itself is already saved; an alias that failed to write
      // is a missed convenience, not a reason to fail a save that succeeded.
      console.error("[invoices/commit] could not record alias:", aliasError.message);
    }
  }

  // project_id is written back alongside the status: 0012 lets it be null only
  // while an upload is still in flight, and its CHECK refuses a committed row
  // without one.
  const { data: updatedUpload, error: uploadUpdateError } = await auth.supabase
    .from("invoice_uploads")
    .update({ status: "committed", invoice_id: purchase.id, project_id: projectId })
    .eq("id", upload.id)
    .select("*")
    .single();
  if (uploadUpdateError) return error(uploadUpdateError.message, 500);

  return json({ purchase, upload: updatedUpload }, 201);
}
