// The triage queue on /invoices — invoices that arrived by email from a sender
// whose domain is not yet a declared supplier.
//
// Without this screen the whole email path is invisible: the drain files these
// rows correctly, and then nothing anywhere in the app mentions them. Mail
// would arrive, store, and simply never be seen.
//
// Quiet by design. When there is nothing to triage it renders *nothing at all*
// — no empty-state box. This sits above the two big "Add an invoice" choices
// on a screen whose job is starting a new invoice, and a permanent "no items"
// panel there would be noise on almost every visit.

import { createClient } from "@/lib/supabase/server";
import TriageActions from "./TriageActions";
import { Badge } from "@/components/ui/Badge";
import type { InvoiceUpload } from "@/types";

// The user-facing name for invoice_uploads.status = 'needs_triage'. The
// database value never appears on screen; this does.
export const TRIAGE_LABEL = "Waiting to be checked";

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

function sizeLabel(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function TriageSection() {
  const supabase = createClient();

  // No .eq("user_id", …) — RLS scopes this (R3).
  const { data, error } = await supabase
    .from("invoice_uploads")
    .select("*")
    .eq("status", "needs_triage")
    .order("received_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  // Migration 0013 is pasted in by hand, so 'needs_triage' may not be a legal
  // status yet. Stay silent rather than breaking the page someone came here to
  // upload an invoice on.
  if (error || !data || data.length === 0) return null;

  const rows = data as InvoiceUpload[];

  return (
    <section className="mb-6">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">
        {TRIAGE_LABEL}{" "}
        <span className="text-sm font-normal text-gray-500">({rows.length})</span>
      </h2>
      <p className="mb-3 text-sm text-gray-500">
        These arrived by email from senders that are not yet known suppliers, so
        they have not been read. Trust the sender to have their invoices read
        automatically from now on, or read this one on its own.
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
                <Badge label={TRIAGE_LABEL} />
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
              <dt className="text-gray-500">Size</dt>
              <dd className="text-right">{sizeLabel(row.size_bytes)}</dd>
            </dl>
            <div className="mt-3">
              <TriageActions uploadId={row.id} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: the same columns as a table. Every column above appears
          here and vice versa — one added to only one of the two is invisible
          on whichever device does not get it. */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-gray-500">
              <th className="py-2 pr-2">File</th>
              <th className="py-2 pr-2">From</th>
              <th className="py-2 pr-2">Received</th>
              <th className="py-2 pr-2 text-right">Size</th>
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
                </td>
                <td className="break-all py-2 pr-2">
                  {senderLabel(row.from_address)}
                </td>
                <td className="py-2 pr-2">{whenLabel(row)}</td>
                <td className="py-2 pr-2 text-right">
                  {sizeLabel(row.size_bytes)}
                </td>
                <td className="py-2 pr-2">
                  <Badge label={TRIAGE_LABEL} />
                </td>
                <td className="py-2 pr-2">
                  <TriageActions uploadId={row.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
