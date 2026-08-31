// "Did the email actually arrive, and was it read?" — on /invoices, under the
// triage queue.
//
// Why this exists
// ---------------
// Until this screen, an invoice that arrived by email and was read
// *successfully* was invisible. TriageSection beside it lists only
// status = 'needs_triage'; nothing anywhere queried invoice_uploads for
// 'extracted' or 'failed'. The review screen at /invoices/[uploadId]/review
// worked perfectly, and there was no link to it from anywhere — you needed the
// upload's UUID out of the SQL editor to reach it.
//
// So the failure mode was: mail arrives, is read correctly, is stored
// correctly, and then sits there for ever because no human is ever shown it.
// Exactly the same shape as the gap DrainHealth.tsx was written to close, one
// step further down the pipeline.
//
// Not quiet by design, unlike DrainHealth and TriageSection. Those two answer
// "is something wrong?", and silence is the right answer when nothing is. This
// one answers "did my email get here?", and silence is the one answer that is
// no use at all — it is indistinguishable from the bug above. So when nothing
// has ever arrived by email it says so, in one line.

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { IconTile } from "@/components/ui/List";
import type { InvoiceUpload } from "@/types";

// User-facing names for invoice_uploads.status. The database values never
// appear on screen. 'needs_triage' is absent on purpose — TriageSection owns
// those rows and has its own label for them (TRIAGE_LABEL).
export const READY_LABEL = "Ready to review";
export const READING_LABEL = "Still reading";
export const UNREADABLE_LABEL = "Couldn't be read";

/** `"Selco <accounts@selco.co.uk>"` → `"accounts@selco.co.uk"` for display. */
function senderLabel(from: string | null): string {
  if (!from) return "unknown sender";
  const angled = from.match(/<([^>]+)>/);
  return (angled ? angled[1] : from).trim();
}

function whenLabel(upload: InvoiceUpload): string {
  const iso = upload.received_at ?? upload.created_at;
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function EmailInvoices() {
  const supabase = createClient();

  // No .eq("user_id", …) — RLS scopes this (R3).
  //
  // Two statuses are excluded, for opposite reasons:
  //
  //   'needs_triage' — TriageSection already renders those, with the two
  //                    buttons that act on them.
  //   'committed'    — the invoice has been reviewed and logged, so it is no
  //                    longer mail waiting to be dealt with. It used to stay
  //                    here as reassurance that the pipeline works, but in
  //                    practice it read as an item still needing attention and
  //                    the list only ever grew. The saved invoice lives on the
  //                    project's Invoices & purchases page from that point on.
  //
  // This list is therefore strictly the outstanding queue: read, still reading,
  // or unreadable.
  const { data, error } = await supabase
    .from("invoice_uploads")
    .select("*")
    .eq("source_channel", "gmail")
    .not("status", "in", "(needs_triage,committed)")
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(50);

  // Migration 0013 is pasted in by hand, so source_channel may not exist yet.
  // Stay silent rather than breaking a screen someone came here to upload on.
  if (error) return null;

  const rows = (data ?? []) as InvoiceUpload[];

  if (rows.length === 0) {
    return (
      <section className="mb-6">
        <SectionHeader title="Invoices from email" />
        <EmptyState
          icon="mail"
          compact
          title="Nothing waiting"
          description="Anything that arrived has been reviewed and logged."
          action={
            <Link href="/settings" className="btn-secondary btn-sm">
              Check the mailbox connection
            </Link>
          }
        />
      </section>
    );
  }

  return (
    <section className="mb-6">
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            Invoices from email
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gray-200 px-1.5 text-2xs font-bold text-gray-600">
              {rows.length}
            </span>
          </span>
        }
        hint={`Pulled out of the connected mailbox. “${READY_LABEL}” means it has been read and is waiting for you to check it.`}
      />

      {/* Mobile: one card per upload. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="card">
            <div className="flex items-start gap-3">
              <IconTile
                name="receipt"
                tone={
                  row.status === "extracted"
                    ? "good"
                    : row.status === "failed"
                      ? "bad"
                      : "neutral"
                }
              />
              <div className="min-w-0 flex-1">
                <p className="break-words text-[0.9375rem] font-bold leading-snug text-gray-900">
                  {row.original_name ?? "Untitled attachment"}
                </p>
                {row.subject ? (
                  <p className="mt-0.5 break-words text-xs text-gray-500">
                    {row.subject}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0">
                <StatusBadge upload={row} />
              </span>
            </div>

            <dl className="mt-3 space-y-1.5 border-t border-gray-200/70 pt-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-gray-500">From</dt>
                <dd className="min-w-0 break-all text-right font-medium text-gray-800">
                  {senderLabel(row.from_address)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Received</dt>
                <dd className="font-medium text-gray-800">{whenLabel(row)}</dd>
              </div>
            </dl>

            {row.status === "failed" && row.error ? (
              <p className="mt-2.5 break-words rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                {row.error}
              </p>
            ) : null}

            <div className="mt-3">
              <RowAction upload={row} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: the same columns as a table. Every column above appears here
          and vice versa — one added to only one of the two renders is invisible
          on whichever device does not get it. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
              <th className="pb-2.5 pr-3">File</th>
              <th className="pb-2.5 pr-3">From</th>
              <th className="pb-2.5 pr-3">Received</th>
              <th className="pb-2.5 pr-3">Status</th>
              <th className="pb-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/70">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="py-2.5 pr-3 font-semibold text-gray-900">
                  {row.original_name ?? "Untitled attachment"}
                  {row.subject && (
                    <span className="block text-xs font-normal text-gray-500">
                      {row.subject}
                    </span>
                  )}
                  {row.status === "failed" && row.error && (
                    <span className="block text-xs font-normal text-red-600">
                      {row.error}
                    </span>
                  )}
                </td>
                <td className="break-all py-2.5 pr-3 text-gray-600">
                  {senderLabel(row.from_address)}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-gray-600">{whenLabel(row)}</td>
                <td className="py-2.5 pr-3">
                  <StatusBadge upload={row} />
                </td>
                <td className="py-2.5">
                  <RowAction upload={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// 'committed' has no case here: those rows are filtered out of the query above,
// because a reviewed-and-logged invoice has left this queue.
function StatusBadge({ upload }: { upload: InvoiceUpload }) {
  if (upload.status === "extracted") return <Badge label={READY_LABEL} />;
  if (upload.status === "failed") return <Badge label={UNREADABLE_LABEL} />;
  // 'pending' and 'processing' — queued for a read, or being read right now.
  // One label for both: the difference is invisible from here and lasts
  // seconds.
  return <Badge label={READING_LABEL} />;
}

/**
 * Where the row goes when clicked.
 *
 * 'pending'/'processing' get no link at all — the review screen has nothing to
 * show yet. 'committed' never reaches here: those rows leave the list once the
 * invoice has been checked and saved, and are found on the project's Invoices
 * & purchases page instead.
 */
function RowAction({ upload }: { upload: InvoiceUpload }) {
  if (upload.status === "extracted") {
    return (
      <Link
        href={`/invoices/${upload.id}/review`}
        className="btn-primary btn-sm"
      >
        Check &amp; save
      </Link>
    );
  }

  if (upload.status === "failed") {
    // The upload row is still there, so the review screen is still the place
    // that explains the failure in full.
    return (
      <Link
        href={`/invoices/${upload.id}/review`}
        className="btn-secondary btn-sm"
      >
        Details
      </Link>
    );
  }

  return <span className="text-xs text-gray-500">—</span>;
}
