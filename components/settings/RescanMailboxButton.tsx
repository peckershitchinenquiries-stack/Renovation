"use client";

// The "Re-scan the mailbox" button in the Gmail section of /settings.
//
// Why a human needs this at all
// -----------------------------
// Ingestion is driven entirely by gmail_events: a notification arrives, a row
// is written, the drain claims it, walks history from the cursor, and moves the
// cursor on. Every step of that assumes the previous one did its job. When one
// of them files nothing while *reporting success* — and that has now happened
// twice, once for the labelAdded gap and once for the Content-ID gap (see
// app/api/gmail/drain/route.ts notes 6 and 7) — the mail is stranded for good.
// The cursor has moved past it, the event says done, and nothing in the
// ordinary five-minute cycle will ever look at that message again.
//
// Recovering it needed a curl with CRON_SECRET, which is not a thing the person
// who owns this mailbox is going to do. This is that recovery, as a button.
//
// No new route: it POSTs to /api/gmail/drain?backfill=1, the same handler the
// schedule GETs. That route accepts a signed-in caller as well as a cron one
// and pins a signed-in call to that user's own mailboxes. Safe to press at any
// time — the sha256 dedupe turns a repeat into a no-op.

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";

interface DrainResult {
  accountsProcessed: number;
  messagesSeen: number;
  uploadsCreated: number;
  queuedForExtraction: number;
  triaged: number;
  skippedDuplicates: number;
  errors: number;
}

/**
 * How far back the scan looks.
 *
 * Wider than the route's own 7-day default, deliberately. That default matches
 * Gmail's history retention, which is the right window for the automatic 404
 * fallback — going further back there would re-walk mail already filed on every
 * tick. This is a button a human presses *because something went missing*, and
 * by the time anyone notices, a week may well have passed.
 */
const SCAN_DAYS = 30;

export default function RescanMailboxButton() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function run() {
    setBusy(true);
    try {
      const data = await apiFetch<DrainResult>(
        `/api/gmail/drain?backfill=1&days=${SCAN_DAYS}`,
        { method: "POST" }
      );

      // Deliberately specific about the *nothing* case. "Re-scan finished" when
      // nothing was found is exactly the reassuring-but-useless message that let
      // both silent-skip bugs run for a day: it is indistinguishable from a scan
      // that worked. Say what was looked at and what came of it.
      if (data.messagesSeen === 0) {
        toast(
          `No emails with attachments in the last ${SCAN_DAYS} days. Check the invoices label in Gmail.`,
          "info"
        );
      } else if (data.uploadsCreated === 0) {
        toast(
          `Looked at ${data.messagesSeen} email${
            data.messagesSeen === 1 ? "" : "s"
          } — everything had already been read.`,
          "info"
        );
      } else {
        const forReview =
          data.queuedForExtraction > 0
            ? ` ${data.queuedForExtraction} being read now.`
            : "";
        const forTriage =
          data.triaged > 0
            ? ` ${data.triaged} from an unknown sender, waiting for you to confirm.`
            : "";
        toast(
          `Found ${data.uploadsCreated} new attachment${
            data.uploadsCreated === 1 ? "" : "s"
          }.${forReview}${forTriage}`,
          "success"
        );
      }

      // The invoices screen is where the result shows up, and this section's own
      // "last email" line is read on the server, so both want a re-read.
      router.refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not re-scan the mailbox.",
        "error"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="btn-secondary text-xs disabled:opacity-50"
    >
      {busy ? "Re-scanning…" : "Re-scan the mailbox"}
    </button>
  );
}
