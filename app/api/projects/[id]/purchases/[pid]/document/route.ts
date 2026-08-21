import { NextResponse } from "next/server";
import { requireUser, error } from "@/lib/api";
import type { InvoiceUpload } from "@/types";

// The original document an invoice was created from — the photo or PDF that was
// uploaded, extracted and then committed into `purchases` (migration 0010).
//
// Why this is a redirect rather than a URL handed to the page:
//
//   The file lives in the private `invoices` bucket, so it can only be opened
//   through a signed URL, and a signed URL expires. Embedding one in the
//   Expenses list at page load would mean every link on a list left open for
//   half an hour is dead — the same expiry problem the review screen already
//   has with its ten-minute window (about.md §8.2). The link in the list is
//   therefore just this route; the URL is minted at the moment it is clicked
//   and is only alive long enough to follow.
//
// The signature is short for the same reason it is short on receipts: it is
// spent immediately by the redirect, and nothing keeps it afterwards.
const SIGNED_URL_SECONDS = 60;

const BUCKET = "invoices";

export async function GET(
  _req: Request,
  { params }: { params: { id: string; pid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // The purchase has to be in the project named in the URL, so a wrong id is a
  // 404 rather than a document from somewhere else. RLS already restricts both
  // tables to this user's rows.
  const { data: purchase } = await auth.supabase
    .from("purchases")
    .select("id")
    .eq("id", params.pid)
    .eq("project_id", params.id)
    .single();
  if (!purchase) return error("Invoice not found", 404);

  // Only a committed upload is the document behind this invoice. An upload that
  // is still pending, failed, or was abandoned points at no purchase at all.
  const { data: uploads } = await auth.supabase
    .from("invoice_uploads")
    .select("*")
    .eq("invoice_id", params.pid)
    .eq("status", "committed")
    .order("created_at", { ascending: false })
    .limit(1);

  const upload = ((uploads ?? []) as InvoiceUpload[])[0];
  // Not an error worth dressing up: most invoices are typed in by hand and
  // simply have no file. The list only links the ones that do.
  if (!upload?.storage_path)
    return error("No document was stored for this invoice", 404);

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUrl(upload.storage_path, SIGNED_URL_SECONDS);
  if (signError || !signed)
    return error(signError?.message ?? "Could not open the document", 500);

  // 302, and explicitly uncached: the target it points at stops working within
  // the minute, so a cached redirect would be worse than no redirect.
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}
