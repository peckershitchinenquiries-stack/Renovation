import { requireUser, json, error } from "@/lib/api";
import { validateDocument, hasErrors } from "@/lib/validation";
import { buildDocumentPayload } from "@/lib/contactWrite";
import type { DocumentInput } from "@/types";

/**
 * Step 1 of adding a document: create the row and hand the browser somewhere
 * to put the file (migration 0021).
 *
 * The file never passes through this route. Vercel caps serverless request
 * bodies at 4.5MB and a phone photo of a wall is comfortably bigger, so the
 * browser uploads straight to Supabase Storage with a signed upload URL —
 * exactly the pattern app/api/invoices/upload-url/route.ts established, and
 * for exactly the same reason.
 *
 * Unlike an invoice upload, the row is complete on creation: an invoice is
 * uploaded and *then* read by the extractor, whereas a document's title and
 * type are typed by the person choosing the file. So there is no 'pending'
 * state here to get stuck in.
 */

// Wider than the invoice list, because this bucket holds drawings and specs
// as well as photographs. Deliberately still a list rather than "anything":
// an upload field that accepts any bytes at all is how a shared workspace
// becomes a file-sharing service.
const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "image/svg+xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — a scanned A1 drawing is large
const BUCKET = "documents";

interface UploadBody extends DocumentInput {
  filename?: string;
  mime_type?: string;
  file_size?: number;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as UploadBody | null;
  if (!body) return error("A document needs a title and a file", 400);

  const errors = validateDocument(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const filename = body.filename?.trim();
  const mimeType = body.mime_type?.trim();
  const fileSize = Number(body.file_size);

  if (!filename || !mimeType)
    return error("filename and mime_type are required", 400);
  if (!ALLOWED.includes(mimeType))
    return error("Unsupported file type. Use a PDF, an image or a Word file.", 415);
  if (!Number.isFinite(fileSize) || fileSize <= 0)
    return error("file_size is required", 400);
  if (fileSize > MAX_BYTES) return error("File exceeds 25MB limit", 413);

  const projectId = body.project_id?.trim() || null;
  // A project-less document is legitimate — a company insurance certificate is
  // not one job's. But a project that was NAMED has to be real: this
  // RLS-backed read makes a bad id a 404 rather than a foreign-key failure.
  if (projectId) {
    const { data: project } = await auth.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    if (!project) return error("Project not found", 404);
  }

  // The path MUST begin `${user.id}/` — the 0021 storage INSERT policy keys
  // off storage.foldername(name)[1] = auth.uid()::text, the same rule the
  // other two buckets use. Anything else 403s with no useful message.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${auth.user.id}/${projectId ?? "general"}/${Date.now()}-${safeName}`;

  // A new version inherits the chain. `version_no` is read from the row being
  // superseded rather than trusted from the client, so it cannot be typed
  // wrong, and the trigger in 0021 clears the old row's `is_current` flag.
  let version_no = 1;
  const supersedes_id = body.supersedes_id?.trim() || null;
  if (supersedes_id) {
    const { data: previous } = await auth.supabase
      .from("documents")
      .select("version_no")
      .eq("id", supersedes_id)
      .single();
    if (!previous) return error("The document being replaced was not found", 404);
    version_no = Number((previous as { version_no: number }).version_no) + 1;
  }

  const { data: row, error: dbError } = await auth.supabase
    .from("documents")
    .insert({
      ...buildDocumentPayload({ ...body, project_id: projectId }),
      user_id: auth.user.id,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: Math.trunc(fileSize),
      version_no,
      supersedes_id,
    })
    .select("*")
    .single();

  if (dbError?.code === "42P01")
    return error(
      "The documents tables are not installed — run 0021_documents.sql",
      503
    );
  if (dbError) return error(dbError.message, 500);

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    // No usable upload URL means the row is dead on arrival. Don't leave a
    // document behind that points at a file which can never exist — it would
    // show in the list and fail every time somebody opened it.
    await auth.supabase.from("documents").delete().eq("id", row.id);
    return error(
      signError?.message ??
        "Could not create an upload URL. Has the documents bucket been created?",
      500
    );
  }

  return json(
    {
      document: row,
      upload_url: signed.signedUrl,
      token: signed.token,
      path: signed.path,
    },
    201
  );
}
