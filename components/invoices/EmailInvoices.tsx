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
  // 'needs_triage' is excluded because TriageSection already renders those, with
  // the two buttons that act on them. Everything else that came from a mailbox
  // is here, committed rows included: an invoice that has been saved is the
  // most reassuring row on the list, and dropping it would make a working
  // pipeline look idle.
  const { data, error } = await supabase
    .from("invoice_uploads")
    .select("*")
    .eq("source_channel", "gmail")
    .neq("status", "needs_triage")
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
        <h2 className="mb-1 text-lg font-semibold text-gray-900">
          Invoices from email
        </h2>
        <p className="text-sm text-gray-500">
          Nothing has arrived by email yet. Check the mailbox connection on the{" "}
          <Link href="/settings" className="text-blue-600 hover:underline">
            settings screen
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        Invoices from email{" "}
        <span className="text-sm font-normal text-gray-500">
          ({rows.length})
        </span>
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        Attachments pulled out of the connected mailbox. Anything marked{" "}
        <em>{READY_LABEL}</em> has been read and is waiting for you to check it
        before it is saved.
      </p>

      {/* Mobile: one card per upload. */}
      <div className="space-y-2 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 break-words font-medium text-gray-900">
                {row.original_name ?? "Untitled attachment"}
              </p>
              <span className="shrink-0">
                <StatusBadge upload={row} />
              </span>
            </div>
            {row.subject && (
              <p className="break-words text-xs text-gray-500">{row.subject}</p>
            )}
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-gray-100 pt-2 text-xs">
              <dt className="text-gray-500">From</dt>
              <dd className="break-all text-right">
                {senderLabel(row.from_address)}
              </dd>
              <dt className="text-gray-500">Received</dt>
              <dd className="text-right">{whenLabel(row)}</dd>
            </dl>
            {row.status === "failed" && row.error && (
              <p className="mt-2 break-words text-xs text-red-600">
                {row.error}
              </p>
            )}
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
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">File</th>
              <th className="py-2 pr-2">From</th>
              <th className="py-2 pr-2">Received</th>
              <th className="py-2 pr-2">Status</th>
              <th className="py-2 pr-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-2 font-medium">
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
                <td className="break-all py-2 pr-2">
                  {senderLabel(row.from_address)}
                </td>
                <td className="py-2 pr-2">{whenLabel(row)}</td>
                <td className="py-2 pr-2">
                  <StatusBadge upload={row} />
                </td>
                <td className="py-2 pr-2">
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

function StatusBadge({ upload }: { upload: InvoiceUpload }) {
  if (upload.status === "committed") return <Badge label="Paid" />;
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
 * 'committed' points at the saved invoice rather than the review screen, which
 * would only tell the user it was already saved. 'pending'/'processing' get no
 * link at all — the review screen has nothing to show yet.
 */
function RowAction({ upload }: { upload: InvoiceUpload }) {
  if (upload.status === "committed") {
    if (!upload.invoice_id || !upload.project_id) {
      return <span className="text-xs text-gray-500">Saved</span>;
    }
    return (
      <Link
        href={`/projects/${upload.project_id}/purchases/${upload.invoice_id}/edit`}
        className="text-xs text-blue-600 hover:underline"
      >
        Open the invoice
      </Link>
    );
  }

  if (upload.status === "extracted") {
    return (
      <Link
        href={`/invoices/${upload.id}/review`}
        className="btn-primary min-h-touch text-xs"
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
        className="text-xs text-blue-600 hover:underline"
      >
        Details
      </Link>
    );
  }

  return <span className="text-xs text-gray-500">—</span>;
}
