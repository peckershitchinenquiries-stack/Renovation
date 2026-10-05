"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { Badge, DotBadge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedControl, ChipRow } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Icon, type IconName } from "@/components/ui/Icon";
import { IconTile, ListCard, ListRow } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import ActivityForm from "@/components/forms/ActivityForm";
import SnagForm from "@/components/forms/SnagForm";
import DocumentUpload from "@/components/documents/DocumentUpload";
import {
  ACTIVITY_KIND_LABELS,
  SNAG_SEVERITY_LABELS,
  SNAG_STATUS_LABELS,
  type ActivityKind,
  type ActivityView,
  type CommunicationBundle,
  type Project,
  type SnagStatus,
  type SnagView,
} from "@/types";

type View = "activity" | "snags";

const KIND_ICON: Record<ActivityKind, IconName> = {
  call: "info",
  site_visit: "home",
  decision: "check",
  email: "mail",
  meeting: "list",
  note: "edit",
};

const SNAG_TONE: Record<SnagStatus, "bad" | "warn" | "good" | "neutral"> = {
  open: "bad",
  fixed: "warn",
  verified: "good",
  wont_fix: "neutral",
};

/**
 * The project's log: what happened, and what is wrong (migration 0022).
 *
 * Two segments of one screen, because they are the same act of recording from
 * the same place at the same moment — you walk the job, you note that the
 * inspector rang, and you note the three things that need doing again.
 */
export default function LogScreen({
  bundle,
  project,
  initialView,
  autoAdd = false,
}: {
  // Null means migration 0022 has not been run.
  bundle: CommunicationBundle | null;
  project: Project;
  initialView: View;
  /**
   * Open the add form for `initialView` straight away (`?add=1`).
   *
   * Set by the project header's "+ Add → Snag" and "+ Add → Log entry". The
   * point of those entries is to record something while standing in front of
   * it, so arriving on a list and having to find the button again defeats
   * them. It is read once, as the initial state — not watched — so closing the
   * form does not reopen it and the URL is left alone.
   */
  autoAdd?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [view, setView] = useState<View>(initialView);
  const [filter, setFilter] = useState<string>("open");
  const [addingActivity, setAddingActivity] = useState(
    autoAdd && initialView === "activity"
  );
  const [addingSnag, setAddingSnag] = useState(
    autoAdd && initialView === "snags"
  );
  const [editingSnag, setEditingSnag] = useState<SnagView | null>(null);
  const [photoFor, setPhotoFor] = useState<SnagView | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<ActivityView | null>(null);
  const [deletingSnag, setDeletingSnag] = useState<SnagView | null>(null);

  const snags = useMemo(() => bundle?.snags ?? [], [bundle]);
  const openCount = snags.filter((s) => s.status === "open").length;
  const safetyCount = snags.filter(
    (s) => s.status === "open" && s.severity === "safety"
  ).length;

  const visibleSnags = useMemo(() => {
    const rows =
      filter === "all"
        ? snags
        : filter === "safety"
          ? snags.filter((s) => s.severity === "safety" && s.status === "open")
          : snags.filter((s) => s.status === filter);
    // Safety first, then open before closed, then newest.
    const rank = (s: SnagView) =>
      (s.severity === "safety" ? 0 : s.severity === "major" ? 1 : 2) +
      (s.status === "open" ? 0 : 10);
    return rows
      .slice()
      .sort((a, b) => rank(a) - rank(b) || b.raised_on.localeCompare(a.raised_on));
  }, [snags, filter]);

  async function removeEntry(entry: ActivityView) {
    try {
      await apiFetch(`/api/projects/${project.id}/activity/${entry.id}`, {
        method: "DELETE",
      });
      toast("Entry removed", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    } finally {
      setDeletingEntry(null);
    }
  }

  async function removeSnag(snag: SnagView) {
    try {
      await apiFetch(`/api/projects/${project.id}/snags/${snag.id}`, {
        method: "DELETE",
      });
      toast("Snag removed", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    } finally {
      setDeletingSnag(null);
    }
  }

  if (!bundle)
    return (
      <div>
        <PageHeader
          title="Log"
          subtitle={project.name}
          backHref={`/projects/${project.id}`}
          backLabel="Back to project"
        />
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-600/20">
          <p className="text-sm font-bold text-amber-900">
            The log tables are not there yet
          </p>
          <p className="mt-1 text-[0.8125rem] leading-relaxed text-amber-800">
            Run <code>0022_activity_snags.sql</code> in the Supabase SQL editor
            and this screen will fill itself in. Migrations in this project are
            applied by hand — writing the file does not run it.
          </p>
        </div>
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Log"
        subtitle={
          openCount > 0
            ? `${openCount} open ${openCount === 1 ? "snag" : "snags"} · ${project.name}`
            : project.name
        }
        backHref={`/projects/${project.id}`}
        backLabel="Back to project"
        action={
          <button
            type="button"
            onClick={() =>
              view === "activity" ? setAddingActivity(true) : setAddingSnag(true)
            }
            className="btn btn-primary btn-sm"
          >
            <Icon name="plus" size={16} />
            Add
          </button>
        }
        below={
          <SegmentedControl
            fill
            label="Log section"
            value={view}
            onChange={setView}
            options={[
              { value: "activity", label: "Activity" },
              {
                value: "snags",
                label: `Snags${openCount ? ` (${openCount})` : ""}`,
              },
            ]}
          />
        }
      />

      {/* An open safety snag should never need looking for. It sits above both
          segments, not inside the snagging list, because the person who most
          needs to see it is the one who came here to write down a phone call. */}
      {safetyCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setView("snags");
            setFilter("safety");
          }}
          className="mb-4 flex w-full items-center gap-3 rounded-2xl bg-red-50 p-4 text-left ring-1 ring-inset ring-red-600/15"
        >
          <Icon name="alert" size={19} className="shrink-0 text-red-600" />
          <span className="min-w-0 flex-1 text-sm font-bold text-red-800">
            {safetyCount} open safety{" "}
            {safetyCount === 1 ? "snag" : "snags"}
          </span>
          <Icon name="chevronRight" size={18} className="shrink-0 text-red-400" />
        </button>
      ) : null}

      {view === "activity" ? (
        bundle.activity.length === 0 ? (
          <EmptyState
            icon="list"
            title="Nothing logged yet"
            description="Calls, site visits, decisions. The things that get argued about six months later and that nobody wrote down at the time."
            action={
              <button
                type="button"
                onClick={() => setAddingActivity(true)}
                className="btn btn-primary"
              >
                <Icon name="plus" size={16} />
                Add an entry
              </button>
            }
          />
        ) : (
          <ListCard>
            {bundle.activity.map((entry) => (
              <ListRow
                key={entry.id}
                leading={
                  <IconTile name={KIND_ICON[entry.kind]} tone="brand" />
                }
                title={entry.summary}
                subtitle={
                  <>
                    <span className="font-medium text-gray-600">
                      {ACTIVITY_KIND_LABELS[entry.kind]}
                    </span>
                    {" · "}
                    {formatDisplayDate(entry.occurred_at.slice(0, 10))}
                    {entry.contact_name ? ` · ${entry.contact_name}` : ""}
                    {entry.task_name ? ` · ${entry.task_name}` : ""}
                    {entry.detail ? (
                      <span className="mt-1 block whitespace-pre-wrap text-gray-500">
                        {entry.detail}
                      </span>
                    ) : null}
                  </>
                }
                trailing={
                  <button
                    type="button"
                    aria-label="Remove entry"
                    onClick={() => setDeletingEntry(entry)}
                    className="btn-icon shrink-0 text-gray-300 hover:text-red-600"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                }
                chevron={false}
              />
            ))}
          </ListCard>
        )
      ) : null}

      {/* The log has always been capped at 300 rows, and until 2026-10-01
          nothing said so: the 301st entry simply was not there and the list
          looked complete. On a year-long job that is the oldest third of the
          record quietly missing from the screen people go to in order to
          remember what was agreed.

          Only rendered when the cap is actually reached, so a normal project
          never sees a sentence about a limit it has not hit. */}
      {view === "activity" &&
      bundle.activity_total > bundle.activity.length ? (
        <p className="mt-3 px-1 text-xs leading-relaxed text-gray-500">
          Showing the most recent {bundle.activity.length} of{" "}
          {bundle.activity_total} entries. Older ones are still stored — they
          are not shown here.
        </p>
      ) : null}

      {view === "snags" ? (
        <div className="space-y-3">
          <ChipRow
            label="Filter snags"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open", count: openCount },
              {
                value: "safety",
                label: "Safety",
                count: safetyCount,
              },
              {
                value: "fixed",
                label: "Fixed",
                count: snags.filter((s) => s.status === "fixed").length,
              },
              {
                value: "verified",
                label: "Verified",
                count: snags.filter((s) => s.status === "verified").length,
              },
              { value: "all", label: "All", count: snags.length },
            ]}
          />

          {visibleSnags.length === 0 ? (
            <EmptyState
              icon="alert"
              title={filter === "open" ? "Nothing open" : "Nothing to show"}
              description={
                filter === "open"
                  ? "No open snags on this project. Anything raised and fixed is under the other filters."
                  : "No snags match this filter."
              }
              action={
                <button
                  type="button"
                  onClick={() => setAddingSnag(true)}
                  className="btn btn-secondary"
                >
                  <Icon name="plus" size={16} />
                  Raise a snag
                </button>
              }
            />
          ) : (
            <div className="space-y-2.5">
              {visibleSnags.map((snag) => (
                <div key={snag.id} className="card p-0">
                  <button
                    type="button"
                    onClick={() => setEditingSnag(snag)}
                    className="flex w-full items-start gap-3 px-4 pb-3 pt-3.5 text-left"
                  >
                    <IconTile
                      name={snag.severity === "safety" ? "alert" : "hammer"}
                      tone={SNAG_TONE[snag.status]}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[0.9375rem] font-bold text-gray-900">
                        {snag.title}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {[
                          snag.location_room,
                          snag.contact_name,
                          snag.task_name,
                          `raised ${formatDisplayDate(snag.raised_on)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge
                        label={SNAG_STATUS_LABELS[snag.status]}
                        tone={SNAG_TONE[snag.status]}
                      />
                      <DotBadge
                        label={SNAG_SEVERITY_LABELS[snag.severity]}
                        tone={
                          snag.severity === "safety"
                            ? "bad"
                            : snag.severity === "major"
                              ? "warn"
                              : "neutral"
                        }
                      />
                    </span>
                  </button>

                  {snag.description ? (
                    <p className="border-t border-gray-200/70 px-4 py-2.5 text-[0.8125rem] leading-relaxed text-gray-600">
                      {snag.description}
                    </p>
                  ) : null}

                  {/* Snag photos are `documents` rows with a snag_id — the same
                      store, the same upload route, the same bucket. Not a
                      second file store (0022). */}
                  {snag.photos.length > 0 ? (
                    <div className="flex gap-2 overflow-x-auto border-t border-gray-200/70 px-4 py-3">
                      {snag.photos.map((photo) => (
                        <a
                          key={photo.id}
                          href={`/api/documents/${photo.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/documents/${photo.id}/file`}
                            alt={photo.title}
                            loading="lazy"
                            className="h-20 w-24 rounded-xl bg-gray-100 object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <div className="flex items-center gap-1 border-t border-gray-200/70 px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setPhotoFor(snag)}
                      className="btn btn-ghost btn-sm"
                    >
                      <Icon name="camera" size={15} />
                      Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingSnag(snag)}
                      className="btn btn-ghost btn-sm"
                    >
                      <Icon name="edit" size={15} />
                      Edit
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      aria-label="Remove snag"
                      onClick={() => setDeletingSnag(snag)}
                      className="btn-icon text-gray-300 hover:text-red-600"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <Sheet
        open={addingActivity}
        onClose={() => setAddingActivity(false)}
        title="Log something"
        description="A call, a site visit, a decision. Dated when it happened, not when it was typed."
        size="lg"
      >
        <ActivityForm
          projectId={project.id}
          phases={bundle.phases}
          tasks={bundle.tasks}
          contacts={bundle.contacts}
          onSaved={() => {
            setAddingActivity(false);
            router.refresh();
          }}
          onCancel={() => setAddingActivity(false)}
        />
      </Sheet>

      <Sheet
        open={addingSnag || editingSnag !== null}
        onClose={() => {
          setAddingSnag(false);
          setEditingSnag(null);
        }}
        title={editingSnag ? "Edit snag" : "Raise a snag"}
        size="lg"
      >
        <SnagForm
          projectId={project.id}
          snag={editingSnag ?? undefined}
          phases={bundle.phases}
          tasks={bundle.tasks}
          contacts={bundle.contacts}
          onSaved={() => {
            setAddingSnag(false);
            setEditingSnag(null);
            router.refresh();
          }}
          onCancel={() => {
            setAddingSnag(false);
            setEditingSnag(null);
          }}
        />
      </Sheet>

      <Sheet
        open={photoFor !== null}
        onClose={() => setPhotoFor(null)}
        title="Photograph the snag"
        description={photoFor?.title}
        size="lg"
      >
        {photoFor ? (
          <DocumentUpload
            projectId={project.id}
            snagId={photoFor.id}
            defaultType="photo"
            phases={bundle.phases}
            tasks={bundle.tasks}
            onSaved={() => {
              setPhotoFor(null);
              router.refresh();
            }}
            onCancel={() => setPhotoFor(null)}
          />
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={deletingEntry !== null}
        title="Remove this log entry?"
        message="There is no undo, and no edit — the log is deliberately append-only, so a correction means deleting this and writing a new entry."
        confirmLabel="Remove"
        danger
        onConfirm={() => deletingEntry && removeEntry(deletingEntry)}
        onCancel={() => setDeletingEntry(null)}
      />

      <ConfirmDialog
        open={deletingSnag !== null}
        title="Remove this snag?"
        message={`"${deletingSnag?.title ?? ""}" will be deleted. Its photos stay in the document store. If it was looked at and deliberately left, set it to Won't fix instead.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => deletingSnag && removeSnag(deletingSnag)}
        onCancel={() => setDeletingSnag(null)}
      />
    </div>
  );
}
