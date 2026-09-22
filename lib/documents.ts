/**
 * Documents — version chains, expiry, and the photo timeline.
 *
 * Everything here is derived on read, with one deliberate exception that is
 * NOT derived here at all: `is_current`. It is a stored column, maintained by
 * a trigger in migration 0021, and the reasoning is in that file's header and
 * in about.md §19. This module reads it and never writes it.
 *
 * `expiryStatus` is imported from lib/certifications.ts rather than being
 * written again: a warranty and a Gas Safe certificate expire in exactly the
 * same way, and two functions answering the same question would eventually
 * answer differently.
 */

import { expiryStatus, todayISO } from "@/lib/certifications";
import type { DocType, DocumentView, ProjectDocument } from "@/types";

/**
 * Every version of one document, oldest first.
 *
 * Walks `supersedes_id` backwards from the given row to the original, then
 * forwards to the newest, so it works whichever version you started from —
 * which matters, because a link in somebody's email points at rev B.
 *
 * The `seen` set is not paranoia: `supersedes_id` is nullable and editable,
 * and a chain that loops would otherwise hang the page rather than show a
 * wrong answer. The database cannot express "this chain is acyclic" any more
 * cheaply than it could for task dependencies (migration 0016), so it is
 * guarded in TypeScript here, in the same place and for the same reason.
 */
export function versionChain<T extends ProjectDocument>(
  doc: T,
  all: T[]
): T[] {
  const byId = new Map(all.map((d) => [d.id, d]));
  const supersededBy = new Map<string, T>();
  for (const d of all) if (d.supersedes_id) supersededBy.set(d.supersedes_id, d);

  // Backwards to the original.
  const seen = new Set<string>([doc.id]);
  let first = doc;
  while (first.supersedes_id) {
    const prev = byId.get(first.supersedes_id);
    if (!prev || seen.has(prev.id)) break;
    seen.add(prev.id);
    first = prev;
  }

  // Forwards to the newest.
  const chain: T[] = [first];
  let cursor: T | undefined = first;
  const walked = new Set<string>([first.id]);
  while (cursor) {
    const next: T | undefined = supersededBy.get(cursor.id);
    if (!next || walked.has(next.id)) break;
    walked.add(next.id);
    chain.push(next);
    cursor = next;
  }
  return chain;
}

/** The newest row in a document's chain — whichever one carries is_current. */
export function currentVersion<T extends ProjectDocument>(
  doc: T,
  all: T[]
): T {
  const chain = versionChain(doc, all);
  return chain[chain.length - 1] ?? doc;
}

/**
 * Attach the derived fields every document screen needs.
 *
 * `version_count` is computed once per document from the whole set rather than
 * by calling versionChain per row, which would be quadratic on a project with
 * a lot of drawings.
 */
export function documentViews(
  documents: ProjectDocument[],
  names: {
    phases?: Map<string, string>;
    tasks?: Map<string, string>;
    contacts?: Map<string, string>;
  } = {},
  today: string = todayISO()
): DocumentView[] {
  // How many rows sit in each chain, keyed by the chain's ROOT, so every
  // member of a chain reports the same count.
  const byId = new Map(documents.map((d) => [d.id, d]));
  const rootOf = new Map<string, string>();
  const findRoot = (doc: ProjectDocument): string => {
    const cached = rootOf.get(doc.id);
    if (cached) return cached;
    const seen = new Set<string>([doc.id]);
    let cursor = doc;
    while (cursor.supersedes_id) {
      const prev = byId.get(cursor.supersedes_id);
      if (!prev || seen.has(prev.id)) break;
      seen.add(prev.id);
      cursor = prev;
    }
    for (const id of seen) rootOf.set(id, cursor.id);
    return cursor.id;
  };

  const chainSize = new Map<string, number>();
  for (const doc of documents) {
    const root = findRoot(doc);
    chainSize.set(root, (chainSize.get(root) ?? 0) + 1);
  }

  return documents.map((doc) => {
    const { state, days_remaining } = expiryStatus(doc.expires_on, today);
    return {
      ...doc,
      state,
      days_remaining,
      phase_name: doc.phase_id ? names.phases?.get(doc.phase_id) ?? null : null,
      task_name: doc.task_id ? names.tasks?.get(doc.task_id) ?? null : null,
      contact_name: doc.contact_id
        ? names.contacts?.get(doc.contact_id) ?? null
        : null,
      version_count: chainSize.get(findRoot(doc)) ?? 1,
    };
  });
}

/**
 * The photo timeline: photographs in CAPTURE order, grouped by phase.
 *
 * Ordered by `taken_at` and not by upload date, which is the whole point —
 * a photo taken in February and uploaded in June belongs in February, and
 * `created_at` cannot say so. Photos with no capture date sort last, in their
 * own group, rather than being silently placed on the day they were uploaded:
 * a timeline that invents dates is worse than one with a gap in it.
 */
export interface PhotoGroup {
  phase_id: string | null;
  phase_name: string;
  photos: DocumentView[];
}

export function photoTimeline(
  documents: DocumentView[],
  phaseOrder: { id: string; name: string }[],
  room?: string | null
): PhotoGroup[] {
  const photos = documents
    .filter((d) => d.doc_type === "photo")
    .filter((d) => !room || d.location_room === room)
    .sort((a, b) => {
      if (!a.taken_at && !b.taken_at)
        return a.created_at.localeCompare(b.created_at);
      if (!a.taken_at) return 1;
      if (!b.taken_at) return -1;
      return a.taken_at.localeCompare(b.taken_at);
    });

  const groups: PhotoGroup[] = [];
  const push = (phase_id: string | null, phase_name: string) => {
    const inGroup = photos.filter((p) => p.phase_id === phase_id);
    if (inGroup.length > 0)
      groups.push({ phase_id, phase_name, photos: inGroup });
  };

  for (const phase of phaseOrder) push(phase.id, phase.name);
  push(null, "Unphased");
  return groups;
}

/** Every room named on a project's photos, for the timeline's filter. */
export function photoRooms(documents: ProjectDocument[]): string[] {
  return [
    ...new Set(
      documents
        .filter((d) => d.doc_type === "photo" && d.location_room)
        .map((d) => d.location_room as string)
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Which document types are worth showing as a filter, and in what order.
 *
 * Photos are last because they are browsed on the timeline, not in the list.
 */
export const DOC_TYPE_ORDER: DocType[] = [
  "planning",
  "building_control",
  "certificate",
  "warranty",
  "drawing",
  "spec",
  "contract",
  "other",
  "photo",
];

/** A rough icon choice per type, so a list of files is scannable. */
export function docTypeIcon(
  type: DocType
): "receipt" | "camera" | "list" | "info" | "check" | "package" {
  switch (type) {
    case "photo":
      return "camera";
    case "drawing":
    case "spec":
      return "list";
    case "certificate":
    case "warranty":
      return "check";
    case "planning":
    case "building_control":
    case "contract":
      return "receipt";
    default:
      return "package";
  }
}

/**
 * What the document store accepts — ONE list, read by both ends.
 *
 * It used to be two lists that disagreed. The route's `ALLOWED` held eight
 * types; the file picker said `accept="image/*,application/pdf,.doc,.docx,.txt"`,
 * which is every image format a browser knows. So a GIF, a BMP or a TIFF
 * passed the picker happily and came back a 415 — after the whole form had
 * been filled in. A picker that offers a file the server will refuse is worse
 * than one that does not offer it at all.
 *
 * **This list is mirrored on the bucket itself by migration 0025, and the two
 * change together** (about.md §9.2). The route never sees the file, so only
 * the bucket actually enforces anything; this is the first line, kept because
 * it can say *why* under the right field where a 400 from Storage cannot.
 *
 * `image/svg+xml` is deliberately absent from all three places. An SVG is a
 * scripted document, not a picture, and these are served inline through a
 * redirect to a signed URL. Nothing here needs one — drawings arrive as PDFs.
 */
export const DOCUMENT_MIME_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // Both spellings of the same iPhone container. The route accepted `heic`
  // alone, but iOS and Windows hand over `image/heif` often enough that the
  // difference was a guaranteed 415 on a photo the user was entitled to add.
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

/**
 * Filename extension → type, for files the BROWSER cannot type.
 *
 * `file.type` is empty surprisingly often — it is on some iOS versions for
 * HEIC, which is exactly the case this store has to handle. The old code sent
 * `file.type || "application/octet-stream"`, and octet-stream is on no list
 * anywhere, so those uploads were a certain 415.
 *
 * Deriving from the extension is a guess, but it is a guess about a file the
 * person chose out of their own photo library, and it is only ever allowed to
 * produce a type that is on the list above. Substituting something that lets
 * anything through would be a different thing entirely.
 */
const EXTENSION_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
};

/**
 * What to send as a file's `mime_type`, or null if it is not something this
 * store takes.
 *
 * Null is the honest answer and the caller says so at the moment the file is
 * chosen, rather than letting the server refuse it at the end of the form.
 */
export function documentMimeType(file: {
  name: string;
  type: string;
}): string | null {
  const declared = (file.type || "").trim().toLowerCase();
  if (DOCUMENT_MIME_TYPES.includes(declared)) return declared;

  const extension = file.name.includes(".")
    ? file.name.split(".").pop()!.toLowerCase()
    : "";
  const derived = EXTENSION_MIME[extension];
  if (!derived) return null;

  // Nothing said, or `application/octet-stream`, which is the browser saying
  // exactly that — this is the case the fallback exists for, so the extension
  // decides on its own.
  if (!declared || declared === "application/octet-stream") return derived;

  // Something WAS said and it is not on the list. The extension is allowed to
  // settle a near miss of the same kind — `image/jpg` for a .jpg is a real
  // thing some systems send — but not to overrule the browser outright: a file
  // named .jpg that the browser says is a video is not a photograph, and
  // hunting through the filename for a friendlier answer is precisely the
  // "silently substitute a type that lets anything through" this must not do.
  return declared.split("/")[0] === derived.split("/")[0] ? derived : null;
}

/**
 * The `accept` attribute for the file picker, built from the same list.
 *
 * Extensions as well as types, because a picker matching on type alone hides
 * exactly the untyped files `documentMimeType` exists to rescue.
 */
export const DOCUMENT_FILE_ACCEPT = [
  ...DOCUMENT_MIME_TYPES,
  ...Object.keys(EXTENSION_MIME).map((e) => `.${e}`),
].join(",");

/** Human file size. Null size renders as an em dash by the caller. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
