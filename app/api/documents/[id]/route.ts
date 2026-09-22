import { requireUser, json, error } from "@/lib/api";
import { validateDocument, hasErrors } from "@/lib/validation";
import { buildDocumentPayload } from "@/lib/contactWrite";
import type { DocumentInput, ProjectDocument } from "@/types";

/**
 * Edit a document's details — its title, type, dates and what it is about.
 *
 * Deliberately cannot change the file, the version number or what it
 * supersedes. A new file is a new VERSION (POST /api/documents/upload-url with
 * `supersedes_id`), which keeps the old one readable — the entire point of
 * drawing version control is that rev B does not vanish when rev C arrives.
 * Letting an edit swap the bytes under an unchanged version number would make
 * the whole chain untrustworthy.
 *
 * **It MERGES.** `buildDocumentPayload` writes every one of its columns on
 * every call, which is right for an insert and wrong for a PATCH: a form that
 * posted only the title would silently null `phase_id`, `task_id`, `taken_at`,
 * `notes` — and `project_id`, which is the dangerous one, because a document
 * with no project is a deliberate feature (a company insurance certificate is
 * not one job's) and so a nulled one quietly appears on EVERY project's list
 * rather than erroring anywhere.
 *
 * The edit form sends the whole object, so the merge is belt and braces there.
 * It is not belt and braces for anything else that ever calls this: a PATCH
 * whose name means "change these fields" has to mean that, or the next caller
 * writes the obvious thing and loses data without a single error.
 *
 * A field is cleared by sending it empty — `text()` turns "" into null — which
 * is what the form does for a box somebody emptied. Absent and empty are
 * different, and that is the whole distinction a merge exists to keep.
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const body = (await req.json().catch(() => ({}))) as DocumentInput;

  const { data: existing, error: readError } = await auth.supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (readError?.code === "42P01")
    return error(
      "The documents tables are not installed — run 0021_documents.sql",
      503
    );
  if (!existing) return error("Document not found", 404);

  const merged = {
    ...(existing as unknown as DocumentInput),
    ...body,
  } as DocumentInput;

  const errors = validateDocument(merged as unknown as Record<string, unknown>);
  if (hasErrors(errors)) return error("Validation failed", 422, errors);

  const { data, error: dbError } = await auth.supabase
    .from("documents")
    .update(buildDocumentPayload(merged))
    .eq("id", params.id)
    .select()
    .single();
  if (dbError) return error(dbError.message, 500);
  if (!data) return error("Document not found", 404);

  return json(data);
}

/**
 * Delete a document, and the file behind it.
 *
 * The storage object goes too, because unlike a receipt there is nothing else
 * pointing at it — an orphaned file in a private bucket is invisible, costs
 * money and can never be found again.
 *
 * The version chain is repaired first. `supersedes_id` is `on delete set null`,
 * so deleting rev B out of A → B → C would silently break C's link back to A
 * and leave A marked superseded by nothing — which is exactly the ambiguity
 * `is_current` exists to prevent. Re-pointing C at A keeps the chain whole.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data: doc } = await auth.supabase
    .from("documents")
    .select("*")
    .eq("id", params.id)
    .single();
  if (!doc) return error("Document not found", 404);
  const document = doc as ProjectDocument;

  // Anything that superseded this row now supersedes what this row did.
  const { data: successor } = await auth.supabase
    .from("documents")
    .select("id")
    .eq("supersedes_id", params.id)
    .maybeSingle();
  if (successor)
    await auth.supabase
      .from("documents")
      .update({ supersedes_id: document.supersedes_id })
      .eq("id", (successor as { id: string }).id);

  // If nothing superseded it, whatever it superseded becomes current again —
  // otherwise deleting the newest revision leaves a chain with no current
  // version at all, and the list would show nothing.
  if (!successor && document.supersedes_id)
    await auth.supabase
      .from("documents")
      .update({ is_current: true })
      .eq("id", document.supersedes_id);

  const { error: dbError } = await auth.supabase
    .from("documents")
    .delete()
    .eq("id", params.id);
  if (dbError) return error(dbError.message, 500);

  // Storage last, and its failure is logged rather than returned: the row is
  // already gone, so failing the request would tell the user nothing happened
  // when in fact the document has been removed. A stranded file is a tidiness
  // problem; a misleading error is a correctness one.
  const { error: storageError } = await auth.supabase.storage
    .from("documents")
    .remove([document.storage_path]);
  if (storageError)
    console.error(
      "[documents] file left behind in storage:",
      document.storage_path,
      storageError.message
    );

  return json({ ok: true });
}
