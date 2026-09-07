"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import {
  DOC_TYPE_ORDER,
  docTypeIcon,
  formatBytes,
  photoRooms,
  photoTimeline,
  versionChain,
} from "@/lib/documents";
import { expiryLabel, expiryTone } from "@/lib/certifications";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl, ChipRow } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Icon } from "@/components/ui/Icon";
import { IconTile, ListCard, ListRow } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import DocumentUpload from "./DocumentUpload";
import {
  DOC_TYPE_LABELS,
  type DocumentBundle,
  type DocumentView,
  type Project,
} from "@/types";

type View = "files" | "photos";

/**
 * The document store (migration 0021).
 *
 * Two views of one table, because they are read completely differently. A
 * warranty is *looked up* — you know what you want and you want it in five
 * seconds — while photographs are *browsed* in time order to see how a room
 * got from bare joists to plastered. A single list would serve neither.
 */
export default function DocumentsScreen({
  bundle,
  project,
}: {
  // Null means migration 0021 has not been run — which is a different thing
  // from an empty store, and the screen says which.
  bundle: DocumentBundle | null;
  project: Project;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<View>("files");
  const [type, setType] = useState<string>("all");
  const [room, setRoom] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [newVersionOf, setNewVersionOf] = useState<DocumentView | null>(null);
  const [chainOf, setChainOf] = useState<DocumentView | null>(null);
  const [deleting, setDeleting] = useState<DocumentView | null>(null);

  // Memoised because it is the dependency of four useMemo hooks below, and
  // `?? []` builds a fresh array on every render — which would make all four
  // recompute every time any unrelated bit of state moved.
  const documents = useMemo(() => bundle?.documents ?? [], [bundle]);

  // Only current versions in the list. Superseded ones are reachable through
  // the version history of the one that replaced them, which is the whole
  // point of the chain: rev B does not vanish, it stops being the answer.
  const files = useMemo(
    () =>
      documents
        .filter((d) => d.doc_type !== "photo" && d.is_current)
        .filter((d) => type === "all" || d.doc_type === type)
        .sort((a, b) => {
          // Anything expiring or expired first — the only documents here with
          // any urgency — then newest.
          const rank = (d: DocumentView) =>
            d.state === "expired" ? 0 : d.state === "expiring_soon" ? 1 : 2;
          return (
            rank(a) - rank(b) || b.created_at.localeCompare(a.created_at)
          );
        }),
    [documents, type]
  );

  const rooms = useMemo(() => photoRooms(documents), [documents]);
  const groups = useMemo(
    () =>
      photoTimeline(
        documents,
        bundle?.phases ?? [],
        room === "all" ? null : room
      ),
    [documents, bundle?.phases, room]
  );

  const typesPresent = useMemo(() => {
    const present = new Set(
      documents.filter((d) => d.doc_type !== "photo").map((d) => d.doc_type)
    );
    return DOC_TYPE_ORDER.filter((t) => t !== "photo" && present.has(t));
  }, [documents]);

  const photoCount = documents.filter((d) => d.doc_type === "photo").length;

  async function remove(doc: DocumentView) {
    try {
      await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      toast("Document removed", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    } finally {
      setDeleting(null);
    }
  }

  if (!bundle)
    return (
      <div>
        <PageHeader
          title="Documents"
          subtitle={project.name}
          backHref={`/projects/${project.id}`}
          backLabel="Back to project"
        />
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="text-sm font-bold text-amber-900">
            The document store is not there yet
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
            Run <code>0021_documents.sql</code> in the Supabase SQL editor. It
            creates the <code>documents</code> table and the private{" "}
            <code>documents</code> storage bucket — both are needed, and
            migrations in this project are applied by hand.
          </p>
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Documents"
        subtitle={`${documents.length} on file · ${project.name}`}
        backHref={`/projects/${project.id}`}
        backLabel="Back to project"
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={16} />
            Add
          </button>
        }
        below={
          <SegmentedControl
            fill
            label="Document view"
            value={view}
            onChange={setView}
            options={[
              { value: "files", label: "Files" },
              { value: "photos", label: `Photos${photoCount ? ` (${photoCount})` : ""}` },
            ]}
          />
        }
      />

      {view === "files" ? (
        <div className="space-y-3">
          {typesPresent.length > 1 ? (
            <ChipRow
              label="Filter by type"
              value={type}
              onChange={setType}
              options={[
                { value: "all", label: "All" },
                ...typesPresent.map((t) => ({
                  value: t,
                  label: DOC_TYPE_LABELS[t],
                })),
              ]}
            />
          ) : null}

          {files.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="No documents yet"
              description="Planning decisions, building control sign-offs, warranties, gas and electrical certificates, drawings. Everything that is not an invoice lives here."
              action={
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="btn btn-primary"
                >
                  <Icon name="plus" size={16} />
                  Add a document
                </button>
              }
            />
          ) : (
            <ListCard>
              {files.map((doc) => (
                <ListRow
                  key={doc.id}
                  href={`/api/documents/${doc.id}/file`}
                  leading={
                    <IconTile
                      name={docTypeIcon(doc.doc_type)}
                      tone={
                        doc.state === "expired"
                          ? "bad"
                          : doc.state === "expiring_soon"
                            ? "warn"
                            : "brand"
                      }
                    />
                  }
                  title={
                    <span className="flex items-center gap-1.5">
                      {doc.title}
                      {doc.version_count > 1 ? (
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-2xs font-bold text-gray-600">
                          v{doc.version_no}
                        </span>
                      ) : null}
                      {doc.project_id === null ? (
                        <span className="text-2xs font-medium text-gray-400">
                          all projects
                        </span>
                      ) : null}
                    </span>
                  }
                  subtitle={
                    [
                      DOC_TYPE_LABELS[doc.doc_type],
                      doc.reference,
                      doc.phase_name,
                      formatBytes(doc.size_bytes),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
                  meta={
                    doc.expires_on ? (
                      <Badge
                        label={expiryLabel(doc.state, doc.days_remaining)}
                        tone={expiryTone(doc.state)}
                      />
                    ) : null
                  }
                  trailing={
                    <span className="flex shrink-0 items-center gap-0.5">
                      {doc.version_count > 1 ? (
                        <button
                          type="button"
                          aria-label="Version history"
                          title={`${doc.version_count} versions`}
                          onClick={(e) => {
                            e.preventDefault();
                            setChainOf(doc);
                          }}
                          className="btn-icon text-gray-400 hover:text-gray-700"
                        >
                          <Icon name="clock" size={17} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label="Add a new version"
                        title="Add a new version"
                        onClick={(e) => {
                          e.preventDefault();
                          setNewVersionOf(doc);
                        }}
                        className="btn-icon text-gray-400 hover:text-gray-700"
                      >
                        <Icon name="upload" size={17} />
                      </button>
                      <button
                        type="button"
                        aria-label="Remove"
                        onClick={(e) => {
                          e.preventDefault();
                          setDeleting(doc);
                        }}
                        className="btn-icon text-gray-400 hover:text-red-600"
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </span>
                  }
                  chevron={false}
                />
              ))}
            </ListCard>
          )}
        </div>
      ) : (
        <PhotoTimelineView
          groups={groups}
          rooms={rooms}
          room={room}
          onRoom={setRoom}
          onAdd={() => setAdding(true)}
        />
      )}

      <Sheet
        open={adding || newVersionOf !== null}
        onClose={() => {
          setAdding(false);
          setNewVersionOf(null);
        }}
        title={newVersionOf ? "Add a new version" : "Add a document"}
        size="lg"
      >
        <DocumentUpload
          projectId={project.id}
          supersedes={newVersionOf ?? undefined}
          defaultType={view === "photos" && !newVersionOf ? "photo" : "other"}
          phases={bundle.phases}
          tasks={bundle.tasks}
          contacts={bundle.contacts}
          onSaved={() => {
            setAdding(false);
            setNewVersionOf(null);
            router.refresh();
          }}
          onCancel={() => {
            setAdding(false);
            setNewVersionOf(null);
          }}
        />
      </Sheet>

      <Sheet
        open={chainOf !== null}
        onClose={() => setChainOf(null)}
        title="Version history"
        description={chainOf?.title}
        size="md"
      >
        {chainOf ? (
          <ListCard>
            {versionChain(chainOf, documents)
              .slice()
              .reverse()
              .map((version) => (
                <ListRow
                  key={version.id}
                  href={`/api/documents/${version.id}/file`}
                  icon={version.is_current ? "check" : "clock"}
                  iconTone={version.is_current ? "good" : "neutral"}
                  title={`Version ${version.version_no}`}
                  subtitle={`Added ${formatDisplayDate(
                    version.created_at.slice(0, 10)
                  )} · ${formatBytes(version.size_bytes)}`}
                  meta={
                    version.is_current ? (
                      <Badge label="Current" tone="good" />
                    ) : (
                      <Badge label="Superseded" tone="neutral" />
                    )
                  }
                  chevron={false}
                />
              ))}
          </ListCard>
        ) : null}
        <p className="hint mt-3">
          Every version stays readable. Which one is current is stored, not
          worked out on the fly, so it is unambiguous even if the chain is
          edited by hand — see about.md §19.
        </p>
      </Sheet>

      <ConfirmDialog
        open={deleting !== null}
        title="Remove this document?"
        message={`"${deleting?.title ?? ""}" and its file will be deleted. Other versions in its chain stay.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => deleting && remove(deleting)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

/**
 * The photo timeline.
 *
 * Grouped by phase and ordered by CAPTURE date within each — which is why
 * `taken_at` exists as a column separate from `created_at`. Photos with no
 * capture date sort last rather than being placed on the day they happened to
 * be uploaded: a timeline that invents dates is worse than one with a gap.
 */
function PhotoTimelineView({
  groups,
  rooms,
  room,
  onRoom,
  onAdd,
}: {
  groups: { phase_id: string | null; phase_name: string; photos: DocumentView[] }[];
  rooms: string[];
  room: string;
  onRoom: (value: string) => void;
  onAdd: () => void;
}) {
  if (groups.length === 0)
    return (
      <EmptyState
        icon="camera"
        title="No photos yet"
        description="Site progress, tied to a phase and a room and dated when it was taken — so the back bedroom can be seen going from bare joists to plastered, in order."
        action={
          <button type="button" onClick={onAdd} className="btn btn-primary">
            <Icon name="camera" size={16} />
            Add a photo
          </button>
        }
      />
    );

  return (
    <div className="space-y-5">
      {rooms.length > 1 ? (
        <ChipRow
          label="Filter by room"
          value={room}
          onChange={onRoom}
          options={[
            { value: "all", label: "Every room" },
            ...rooms.map((r) => ({ value: r, label: r })),
          ]}
        />
      ) : null}

      {groups.map((group) => (
        <section key={group.phase_id ?? "unphased"}>
          <h2 className="section-title mb-2.5">
            {group.phase_name}
            <span className="ml-2 text-xs font-medium text-gray-400">
              {group.photos.length}
            </span>
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
            {group.photos.map((photo) => (
              <a
                key={photo.id}
                href={`/api/documents/${photo.id}/file`}
                target="_blank"
                rel="noreferrer"
                className="group overflow-hidden rounded-2xl bg-white shadow-card transition active:scale-[0.98]"
              >
                {/* The thumbnail is the real file behind a signed-URL redirect.
                    There is no separate thumbnail pipeline, deliberately: this
                    is a handful of photos per phase, and half an image
                    pipeline is worse than none. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/documents/${photo.id}/file`}
                  alt={photo.title}
                  loading="lazy"
                  className="aspect-[4/3] w-full bg-gray-100 object-cover"
                />
                <div className="px-3 py-2.5">
                  <p className="truncate text-[0.8125rem] font-semibold text-gray-900">
                    {photo.title}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {photo.taken_at ? (
                      formatDisplayDate(photo.taken_at)
                    ) : (
                      <span className="text-gray-400">no date taken</span>
                    )}
                    {photo.location_room ? ` · ${photo.location_room}` : ""}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
