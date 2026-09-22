import { requireUser, json, error } from "@/lib/api";
import { validateDocument, hasErrors } from "@/lib/validation";
import { DOCUMENT_MIME_TYPES } from "@/lib/documents";
import type { DocumentInput } from "@/types";

/**
 * Step 1 of adding a document: hand the browser somewhere to put the file
 * (migration 0021).
 *
 * The file never passes through this route. Vercel caps serverless request
 * bodies at 4.5MB and a phone photo of a wall is comfortably bigger, so the
 * browser uploads straight to Supabase Storage with a signed upload URL —
 * exactly the pattern app/api/invoices/upload-url/route.ts established, and
 * for exactly the same reason.
 *
 * **This route used to create the `documents` row as well, and that was the
 * bug.** The row went in first, the bytes went up second, and if the PUT threw
 * the browser deleted the row again. Which only works while the browser is
 * still alive: close the tab on a slow phone upload and the row survived with
 * no file behind it, showed in the list, and failed every time anybody opened
 * it — `/api/documents/[id]/file` redirected to a signed URL for an object
 * that does not exist.
 *
 * So the order is now bytes first, row second: this route returns a signed URL
 * and nothing else, and `POST /api/documents` creates the row only after
 * LOOKING in the bucket and finding the object. An abandoned upload now leaves
 * an unreferenced object in a private bucket — invisible, and the same
 * tidiness problem the DELETE route already tolerates — rather than a document
 * on screen that cannot be opened.
 *
 * Still no 'pending' state, and deliberately: an invoice is uploaded and *then*
 * read by the extractor, so it genuinely has a half-finished life of its own,
 * whereas a document's title and type are typed by the person choosing the
 * file. There is nothing here to get stuck in — a document either exists or it
 * was never added.
 *
 * The metadata is validated here anyway, before a single byte moves. Sending
 * somebody up a 20MB upload on a phone and only then telling them the title is
 * required would be its own kind of rude.
 */
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
  const mimeType = body.mime_type?.trim().toLowerCase();
  const fileSize = Number(body.file_size);

  if (!filename || !mimeType)
    return error("filename and mime_type are required", 400);
  if (!DOCUMENT_MIME_TYPES.includes(mimeType))
    return error("Unsupported file type. Use a PDF, an image or a Word file.", 415);
  if (!Number.isFinite(fileSize) || fileSize <= 0)
    return error("file_size is required", 400);
  if (fileSize > MAX_BYTES) return error("File exceeds 25MB limit", 413);

  const projectId = body.project_id?.trim() || null;
  // A project-less document is legitimate — a company insurance certificate is
  // not one job's. But a project that was NAMED has to be real: this
  // RLS-backed read makes a bad id a 404 rather than a foreign-key failure.
  // Checked here as well as at claim time so the upload is not attempted at
  // all when it is going to be refused afterwards.
  if (projectId) {
    const { data: project } = await auth.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    if (!project) return error("Project not found", 404);
  }

  const supersedesId = body.supersedes_id?.trim() || null;
  if (supersedesId) {
    const { data: previous, error: previousError } = await auth.supabase
      .from("documents")
      .select("id")
      .eq("id", supersedesId)
      .maybeSingle();
    if (previousError?.code === "42P01")
      return error(
        "The documents tables are not installed — run 0021_documents.sql",
        503
      );
    if (!previous)
      return error("The document being replaced was not found", 404);
  }

  // The path MUST begin `${user.id}/` — the 0021 storage INSERT policy keys
  // off storage.foldername(name)[1] = auth.uid()::text, the same rule the
  // other two buckets use. Anything else 403s with no useful message.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${auth.user.id}/${projectId ?? "general"}/${Date.now()}-${safeName}`;

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed)
    return error(
      signError?.message ??
        "Could not create an upload URL. Has the documents bucket been created?",
      500
    );

  return json(
    {
      upload_url: signed.signedUrl,
      token: signed.token,
      storage_path: signed.path ?? storagePath,
    },
    201
  );
}
