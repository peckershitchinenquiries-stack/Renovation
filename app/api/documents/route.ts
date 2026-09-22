import { requireUser, json, error } from "@/lib/api";
import { validateDocument, hasErrors } from "@/lib/validation";
import { buildDocumentPayload } from "@/lib/contactWrite";
import { DOCUMENT_MIME_TYPES } from "@/lib/documents";
import type { DocumentInput } from "@/types";

/**
 * Step 2 of adding a document: the row, created only once the file is really
 * there (migration 0021).
 *
 * This is the half that used to happen FIRST, and that was the bug. The row
 * went in, the bytes went up, and the browser deleted the row again if the PUT
 * threw — cleanup that only runs while the browser is still alive. Close the
 * tab on a slow phone upload and a document survived with no file behind it:
 * it showed in the list and failed every time somebody opened it, because
 * `/api/documents/[id]/file` cheerfully redirects to a signed URL for an
 * object that does not exist.
 *
 * So the row is not created on a promise. **This route looks in the bucket
 * first**, and a path with nothing behind it is a 404 rather than a document.
 * An upload abandoned halfway now leaves an unreferenced object in a private
 * bucket, which is invisible and is the same tidiness problem the DELETE route
 * already accepts in the other direction — never a broken row on a list.
 *
 * Two figures are taken from the object rather than from the browser while we
 * are looking at it: `size_bytes` and the declared content type. The old code
 * stored whatever the JSON body claimed, which meant the size on screen was a
 * number the client made up.
 */
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB, the same limit 0025 puts on the bucket
const BUCKET = "documents";

interface ClaimBody extends DocumentInput {
  storage_path?: string;
  mime_type?: string;
  file_size?: number;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => null)) as ClaimBody | null;
  if (!body) return error("A document needs a title and a file", 400);

  const errors = validateDocument(body as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const storagePath = body.storage_path?.trim();
  if (!storagePath) return error("storage_path is required", 400);
  // The upload URL this path came from was minted for this user's folder, and
  // the 0021 storage INSERT policy enforces the same rule. Saying so here as
  // well keeps the row and the object describing the same thing.
  if (!storagePath.startsWith(`${auth.user.id}/`))
    return error("That file was not uploaded by you", 403);

  const projectId = body.project_id?.trim() || null;
  if (projectId) {
    const { data: project } = await auth.supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    if (!project) return error("Project not found", 404);
  }

  // ---- the file has to actually be there ----
  const slash = storagePath.lastIndexOf("/");
  const folder = storagePath.slice(0, slash);
  const objectName = storagePath.slice(slash + 1);
  const { data: listed, error: listError } = await auth.supabase.storage
    .from(BUCKET)
    .list(folder, { search: objectName, limit: 100 });
  if (listError)
    return error(
      listError.message || "Could not check the uploaded file",
      500
    );
  // `search` is a prefix match, not an exact one, so the name is compared here.
  const object = (listed ?? []).find((o) => o.name === objectName);
  if (!object)
    return error(
      "The file did not finish uploading — nothing was saved. Try again.",
      404,
      { file: "The upload did not complete" }
    );

  const metadata = (object.metadata ?? {}) as {
    size?: number;
    mimetype?: string;
  };
  const size = Number(metadata.size ?? body.file_size);
  const mimeType = String(
    metadata.mimetype ?? body.mime_type ?? ""
  ).trim().toLowerCase();

  if (!DOCUMENT_MIME_TYPES.includes(mimeType)) {
    await auth.supabase.storage.from(BUCKET).remove([storagePath]);
    return error("Unsupported file type. Use a PDF, an image or a Word file.", 415);
  }
  if (Number.isFinite(size) && size > MAX_BYTES) {
    await auth.supabase.storage.from(BUCKET).remove([storagePath]);
    return error("File exceeds 25MB limit", 413);
  }

  // One row per object. The path carries a timestamp so a collision is not
  // expected, but a retried claim would otherwise make two documents out of
  // one file and the second delete would break the first.
  const { data: already } = await auth.supabase
    .from("documents")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (already) return error("That file has already been added", 409);

  // A new version inherits the chain. `version_no` is read from the row being
  // superseded rather than trusted from the client, so it cannot be typed
  // wrong, and the trigger in 0021 clears the old row's `is_current` flag.
  let version_no = 1;
  const supersedes_id = body.supersedes_id?.trim() || null;
  if (supersedes_id) {
    const { data: previous, error: previousError } = await auth.supabase
      .from("documents")
      .select("version_no")
      .eq("id", supersedes_id)
      .maybeSingle();
    if (previousError?.code === "42P01")
      return error(
        "The documents tables are not installed — run 0021_documents.sql",
        503
      );
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
      size_bytes: Number.isFinite(size) ? Math.trunc(size) : null,
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

  return json(row, 201);
}
