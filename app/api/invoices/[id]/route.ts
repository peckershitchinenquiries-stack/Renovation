import { requireUser, json, error } from "@/lib/api";

const BUCKET = "invoices";

// One upload's status/extraction, plus a short-lived signed URL for the
// original file — so a review screen can show the source document next to
// the extracted fields without the 'invoices' bucket ever being public.
// Server-side only, same pattern as the receipt route's GET.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: upload } = await auth.supabase
    .from("invoice_uploads")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!upload) return error("Upload not found", 404);

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUrl(upload.storage_path, 60 * 5);
  if (signError || !signed)
    return error(signError?.message ?? "Could not sign URL", 500);

  return json({ upload, file_url: signed.signedUrl });
}
