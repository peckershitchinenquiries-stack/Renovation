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
import { SectionHeader } from "@/components/ui/PageHeader";
import { IconTile } from "@/components/ui/List";
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
      <SectionHeader
        title={
          <span className="flex items-center gap-2">
            {TRIAGE_LABEL}
            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-100 px-1.5 text-2xs font-bold text-amber-800">
              {rows.length}
            </span>
          </span>
        }
        hint="From senders that are not yet known suppliers, so they have not been read."
      />

      {/* Mobile: one card per upload. */}
      <div className="space-y-2.5 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="card">
            <div className="flex items-start gap-3">
              <IconTile name="mail" tone="warn" />
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
                <Badge label={TRIAGE_LABEL} />
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
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Size</dt>
                <dd className="tnum font-medium text-gray-800">
                  {sizeLabel(row.size_bytes)}
                </dd>
              </div>
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
            <tr className="text-left text-2xs font-bold uppercase tracking-wider text-gray-500">
              <th className="pb-2.5 pr-3">File</th>
              <th className="pb-2.5 pr-3">From</th>
              <th className="pb-2.5 pr-3">Received</th>
              <th className="pb-2.5 pr-3 text-right">Size</th>
              <th className="pb-2.5 pr-3">Status</th>
              <th className="pb-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200/70">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="py-2.5 pr-3 font-semibold text-gray-900">
                  {row.original_name ?? "Untitled attachment"}
                  {row.subject ? (
                    <span className="block text-xs font-normal text-gray-500">
                      {row.subject}
                    </span>
                  ) : null}
                </td>
                <td className="break-all py-2.5 pr-3 text-gray-600">
                  {senderLabel(row.from_address)}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3 text-gray-600">
                  {whenLabel(row)}
                </td>
                <td className="tnum py-2.5 pr-3 text-right text-gray-600">
                  {sizeLabel(row.size_bytes)}
                </td>
                <td className="py-2.5 pr-3">
                  <Badge label={TRIAGE_LABEL} />
                </td>
                <td className="py-2.5">
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
