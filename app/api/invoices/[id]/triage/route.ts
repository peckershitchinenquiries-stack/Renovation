// POST /api/invoices/[id]/triage — deal with an invoice from an unknown sender.
//
// Why this route exists
// ---------------------
// The drain gates extraction on the sender's domain: a declared supplier is
// read automatically, anybody else is filed as 'needs_triage' and left alone
// (app/api/gmail/drain/route.ts, note 4). That gate was correct and had one
// fatal gap — nothing ever *wrote* supplier_domains, and migration 0013 seeded
// it with no rows. So `known` was false for every sender, every invoice landed
// in triage, and not one was ever extracted.
//
// This is the write path. The table seeds itself from decisions the owner
// actually makes, one sender at a time, rather than from a list of domains
// guessed up front — which is both less work and more accurate, because the
// domain recorded is the one the invoices genuinely arrive from (billing
// sub-domains, mail relays and all).
//
// Two answers, both offered on every triage row:
//
//   { trustSender: true }  — "this is a supplier". Records the domain, so this
//                            invoice AND every future one from them skips
//                            triage entirely.
//   { trustSender: false } — "read this one". Extracts it and records nothing;
//                            the next invoice from them queues for triage
//                            again. The right answer for a one-off, or for a
//                            colleague forwarding somebody else's invoice.
//
// Unlike the drain this runs under a real session, so RLS scopes everything
// and no read here filters by user_id (R3). The one explicit user_id is on the
// supplier_domains *insert*, which has to say who the row belongs to.

import { requireUser, json, error } from "@/lib/api";
import { extractQueued } from "@/lib/gmail/ingestExtract";
import { domainOf } from "@/lib/gmail/domains";
import type { InvoiceUpload } from "@/types";

// Extraction runs inline, exactly as it does on /api/invoices/[id]/extract, so
// this needs the same budget.
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { user, supabase } = auth;

  let trustSender = false;
  try {
    const body = await req.json();
    trustSender = body?.trustSender === true;
  } catch {
    // An empty body means "extract once" — the more cautious of the two.
  }

  // No .eq("user_id", …) — RLS scopes this (R3).
  const { data: uploadRow } = await supabase
    .from("invoice_uploads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!uploadRow) return error("Upload not found", 404);
  const upload = uploadRow as InvoiceUpload;

  if (upload.status === "committed")
    return error("This upload has already been committed to a purchase.", 409);

  // ---- 1. optionally declare the sender -------------------------------
  let trusted: string | null = null;
  if (trustSender) {
    // The *domain*, never the full address. Suppliers send from
    // accounts@, invoices@, noreply@ and a different one next quarter;
    // trusting one mailbox would leave the next invoice in triage.
    const domain = domainOf(upload.from_address);
    if (!domain)
      return error(
        "There is no sender address on this upload to trust — extract it once instead.",
        400
      );

    // Idempotent by hand rather than by upsert: the uniqueness is an
    // expression index — ux_supplier_domains_domain on
    // public.norm_key(domain), added by 0015 when the trust list became one
    // shared list — and PostgREST's on_conflict can only name plain columns.
    // So: look first, insert if absent, and treat a 23505 from a concurrent
    // insert as success — the row we wanted exists either way. The row found
    // here may well have been trusted by somebody else; that is the point.
    const { data: existing } = await supabase
      .from("supplier_domains")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();

    if (!existing) {
      const { error: insertError } = await supabase
        .from("supplier_domains")
        .insert({ user_id: user.id, domain, supplier_id: null });
      if (insertError && insertError.code !== "23505")
        return error(
          `Could not record the sender as a supplier: ${insertError.message}`,
          500
        );
    }
    trusted = domain;
  }

  // ---- 2. take it out of triage and read it ---------------------------
  // 'pending' first, so a crash between here and the extraction leaves the row
  // somewhere the ordinary retry paths understand rather than stuck in triage
  // after the user has already decided.
  const { error: statusError } = await supabase
    .from("invoice_uploads")
    .update({ status: "pending", error: null })
    .eq("id", upload.id);
  if (statusError) return error(statusError.message, 500);

  // The existing extraction flow, not a second copy of it. extractQueued is
  // what the drain uses, so a triaged invoice lands in exactly the state an
  // auto-extracted one does — same columns written, same rate-limit handling,
  // and the same promise that nothing is ever left sitting at 'processing'.
  const [outcome] = await extractQueued(supabase, user.id, [upload.id]);

  if (!outcome)
    return error("Extraction did not run. Try again from the review screen.", 500);

  if (outcome.status === "failed")
    return error(outcome.error ?? "Extraction failed.", 422, { trusted });

  // A rate-limited upload is back at 'pending', not 'failed' — nothing is
  // wrong with it and the drain will pick it up. Say so rather than reporting
  // success and sending the user to a review screen with nothing on it.
  if (outcome.status === "pending")
    return json({
      upload_id: upload.id,
      status: outcome.status,
      trusted,
      message: outcome.error,
    });

  return json({ upload_id: upload.id, status: outcome.status, trusted });
}
