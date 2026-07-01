import { requireUser, json, error } from "@/lib/api";

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const BUCKET = "receipts";

export async function POST(
  req: Request,
  { params }: { params: { eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  // Confirm the expense belongs to the user (RLS-backed read).
  const { data: expense } = await auth.supabase
    .from("expense_entries")
    .select("id, project_id, receipt_url")
    .eq("id", params.eid)
    .single();
  if (!expense) return error("Expense not found", 404);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return error("No file provided", 400);

  // Server-side MIME + size validation before saving the URL to the DB.
  if (!ALLOWED.includes(file.type))
    return error("Unsupported file type. Use JPG, PNG, WebP or PDF.", 415);
  if (file.size > MAX_BYTES) return error("File exceeds 10MB limit", 413);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${auth.user.id}/${expense.project_id}/${expense.id}/${Date.now()}-${safeName}`;

  const { error: upErr } = await auth.supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return error(upErr.message, 500);

  // Remove a previously attached receipt, if any.
  if (expense.receipt_url) {
    await auth.supabase.storage.from(BUCKET).remove([expense.receipt_url]);
  }

  const { data, error: dbError } = await auth.supabase
    .from("expense_entries")
    .update({ receipt_url: path })
    .eq("id", params.eid)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);

  return json({ receipt_url: path, expense: data }, 201);
}

// Return a short-lived signed URL so the private receipt can be opened.
export async function GET(
  _req: Request,
  { params }: { params: { eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { data: expense } = await auth.supabase
    .from("expense_entries")
    .select("receipt_url")
    .eq("id", params.eid)
    .single();
  if (!expense?.receipt_url) return error("No receipt", 404);
  const { data, error: signErr } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUrl(expense.receipt_url, 60 * 5);
  if (signErr || !data) return error(signErr?.message ?? "Could not sign URL", 500);
  return json({ url: data.signedUrl });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { eid: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: expense } = await auth.supabase
    .from("expense_entries")
    .select("id, receipt_url")
    .eq("id", params.eid)
    .single();
  if (!expense) return error("Expense not found", 404);
  if (!expense.receipt_url) return json({ ok: true });

  await auth.supabase.storage.from(BUCKET).remove([expense.receipt_url]);
  const { error: dbError } = await auth.supabase
    .from("expense_entries")
    .update({ receipt_url: null })
    .eq("id", params.eid);
  if (dbError) return error(dbError.message, 500);
  return json({ ok: true });
}
