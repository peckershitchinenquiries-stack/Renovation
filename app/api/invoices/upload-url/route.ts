import { requireUser, json, error } from "@/lib/api";

// Step 1 of invoice ingestion: hand the browser somewhere to put the file.
//
// The file itself never passes through this route. Vercel caps serverless
// request bodies at 4.5MB and a phone photo is comfortably bigger than that,
// so the browser uploads straight to Supabase Storage with a signed upload
// URL and this route only ever sees the file's metadata. This is a
// deliberate departure from app/api/expenses/[eid]/receipt/route.ts, which
// POSTs the file through the route — that path tops out at 10MB and this one
// has to handle 20MB phone photos.

const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const BUCKET = "invoices";

interface UploadUrlBody {
  project_id?: string;
  filename?: string;
  mime_type?: string;
  file_size?: number;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as UploadUrlBody | null;
  const projectId = body?.project_id?.trim();
  const filename = body?.filename?.trim();
  const mimeType = body?.mime_type?.trim();
  const fileSize = Number(body?.file_size);

  if (!projectId || !filename || !mimeType)
    return error("project_id, filename and mime_type are required", 400);
  if (!ALLOWED.includes(mimeType))
    return error("Unsupported file type. Use JPG, PNG, WebP or PDF.", 415);
  if (!Number.isFinite(fileSize) || fileSize <= 0)
    return error("file_size is required", 400);
  if (fileSize > MAX_BYTES) return error("File exceeds 20MB limit", 413);

  // RLS-backed read: a project that isn't the caller's own comes back empty,
  // which becomes a 404 rather than a foreign-key failure on the insert below.
  const { data: project } = await auth.supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .single();
  if (!project) return error("Project not found", 404);

  // Storage path MUST begin `${user.id}/` — the 0010 storage policies key off
  // storage.foldername(name)[1] = auth.uid()::text. Anything else makes every
  // upload 403 with no useful message.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${auth.user.id}/${projectId}/${Date.now()}-${safeName}`;

  const { data: uploadRow, error: dbError } = await auth.supabase
    .from("invoice_uploads")
    .insert({
      user_id: auth.user.id,
      project_id: projectId,
      storage_path: storagePath,
      original_name: filename,
      mime_type: mimeType,
      size_bytes: Math.trunc(fileSize),
      status: "pending",
    })
    .select("*")
    .single();
  if (dbError) return error(dbError.message, 500);

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    // No usable upload URL means the row is dead on arrival — don't leave a
    // 'pending' row behind that can never receive its file.
    await auth.supabase.from("invoice_uploads").delete().eq("id", uploadRow.id);
    return error(signError?.message ?? "Could not create an upload URL", 500);
  }

  return json(
    {
      id: uploadRow.id,
      upload_url: signed.signedUrl,
      token: signed.token,
      path: signed.path,
    },
    201
  );
}
