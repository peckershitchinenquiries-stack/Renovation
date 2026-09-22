import { NextResponse } from "next/server";
import { requireUser, error } from "@/lib/api";
import type { ProjectDocument } from "@/types";

/**
 * Open the file behind a document (migration 0021).
 *
 * A redirect rather than a URL handed to the page, for the reason the invoice
 * document route already gives: the `documents` bucket is private, so it can
 * only be opened through a signed URL, and a signed URL expires. Embedding one
 * in a list at page load means every link on a list left open for half an hour
 * is dead. The link in the list is this route; the URL is minted at the moment
 * it is clicked and lives only long enough to follow.
 *
 * A photo timeline is the case that makes this matter: it is a grid of dozens
 * of images that somebody scrolls slowly, and pre-signing all of them at load
 * would be both a wall of expiring URLs and a wasted round trip per photo.
 */
const SIGNED_URL_SECONDS = 300;
const BUCKET = "documents";

export async function GET(
  req: Request,
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

  // `?download=1` asks the browser to save rather than display. Inline is the
  // default because most of these are looked at, not filed.
  const asked = new URL(req.url).searchParams.get("download") === "1";

  /**
   * An SVG is never rendered inline, whatever was asked for.
   *
   * SVG is a scripted document dressed as a picture. It is no longer an
   * accepted upload type (see the upload route, and migration 0025 which
   * enforces that on the bucket), but rows created before that stay readable,
   * and "we stopped accepting them" is not the same as "none exist". Forcing a
   * download means an old one is saved to disk rather than executed in a tab
   * on the storage origin.
   */
  const isSvg =
    document.mime_type === "image/svg+xml" ||
    /\.svgz?$/i.test(document.storage_path);
  const download = asked || isSvg;

  const { data: signed, error: signError } = await auth.supabase.storage
    .from(BUCKET)
    .createSignedUrl(document.storage_path, SIGNED_URL_SECONDS, {
      // Gives the saved file the document's real title rather than the
      // timestamped storage key nobody would recognise.
      ...(download ? { download: safeFilename(document) } : {}),
    });
  if (signError || !signed)
    return error(signError?.message ?? "Could not open the document", 500);

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "no-store" },
  });
}

/** The document's title as a filename, with the original extension kept. */
function safeFilename(document: ProjectDocument): string {
  const extension = document.storage_path.includes(".")
    ? `.${document.storage_path.split(".").pop()}`
    : "";
  const base = document.title.replace(/[^a-zA-Z0-9._ -]/g, "_").trim();
  return `${base || "document"}${extension}`;
}
