// POST /api/gmail/drain — turn recorded notifications into invoice_uploads rows.
//
// The other half of the split described in app/api/gmail/push/route.ts. The
// push endpoint acks in milliseconds and writes a gmail_events row; this does
// the slow part on a five-minute schedule: walk the mailbox's history, pull
// down the attachments, put them in Storage, and file a row for each one.
//
// **The five-minute schedule is not Vercel's.** Vercel's Hobby plan allows
// daily crons only, so this path is called by cron-job.org over plain HTTPS
// with the same `Authorization: Bearer $CRON_SECRET` header Vercel Cron used to
// send. Two things follow, and both are handled below: that scheduler hangs up
// at 30 seconds (hence DRAIN_TIME_BUDGET_MS) and keeps only the first 64KB of
// the response (hence the counts-only body at the end of handleDrain). See
// README "External scheduler" and about.md §8.4.
//
// ############################################################
// ##  R3 EXCEPTION — this file, and the two Gmail routes     ##
// ##  beside it, are the ONLY places in RenovaTrack where    ##
// ##  RLS is not what scopes the data.                       ##
// ############################################################
//
// Rule R3 (about.md §2) is that no query filters by user_id, because every
// table's policy compares auth.uid() to it. A cron request has no session, so
// auth.uid() is null and those policies match nothing at all. This route
// therefore uses createServiceClient(), which bypasses RLS, and every read is
// keyed on the account and every write sets user_id explicitly from the
// gmail_accounts row. There is a comment at each such call site. Service-role
// usage stays confined to these three routes; nothing under a user session
// gains a .eq("user_id", …). See about.md §8.4.
//
// The five things in here that are load-bearing, and why:
//
//   1. The claim is a compare-and-swap on gmail_events, not an advisory lock.
//      pg_try_advisory_lock is unreachable through PostgREST (it is in
//      pg_catalog, not an exposed schema) and a *session*-level lock taken over
//      a pooled connection would be released on whichever connection happened
//      to serve the next request. An atomic
//      `update … where id = ? and status = 'pending'` is a real mutex: only one
//      worker's update returns a row. Two workers walking history from one
//      cursor would duplicate downloads, but 0013's two unique indexes make a
//      duplicate insert a no-op rather than a second invoice.
//
//   2. The historyId 404 fallback is not defensive coding — it will fire.
//      Gmail prunes history after roughly a week, sooner on a busy mailbox, so
//      any gap longer than that (a holiday, a broken watch, a paused account)
//      leaves the cursor unusable. Falling back to a recent-message scan is the
//      difference between "catches up" and "silently stops working".
//
//   3. Dedupe is on the file's sha256, not the message id. The same invoice
//      PDF routinely arrives twice — forwarded by a colleague, or re-sent by
//      the supplier after a query — and each copy carries a different message
//      id. Hashing the bytes is the only key that survives that. The
//      (message, attachment) check is a cheaper guard that runs first and saves
//      the download.
//
//   4. Extraction is gated on the sender's domain. A known supplier domain
//      means 'pending' and a read; anything else means 'needs_triage' and no
//      read at all. An unknown sender sitting in a triage list costs nothing.
//      Auto-reading it costs a Gemini call and, worse, puts a stranger's
//      attachment into the review queue as if it were an invoice.
//
//   5. The cursor advances last. Everything in the batch is written, and only
//      then does last_history_id move. A crash halfway through re-reads some
//      messages, which the dedupe absorbs; a cursor moved early loses them for
//      good.
//
//   6. The history walk asks for labelAdded as well as messageAdded. The watch
//      is registered on the invoices label, so it fires whenever that label
//      changes — including when it is put on a message that arrived earlier.
//      A `messageAdded` record only exists where the label was there at
//      delivery, i.e. where a Gmail filter applied it. Labelling by hand
//      produces a `labelAdded` record and nothing else, so a walk that read
//      only messageAdded found an empty history, filed nothing, and advanced
//      the cursor over the invoice — with no error anywhere. That happened for
//      real to the first seven invoices ever emailed to this app
//      (updates.md, 2026-08-27).
//
//   7. There is a backfill mode, and it is not a convenience. Everything above
//      is driven by gmail_events: no pending event, no work, whatever is
//      sitting in the mailbox. So any bug that files nothing while *reporting*
//      success — note 6, and the Content-ID bug in isEmbeddedImage below —
//      strands that mail permanently. The cursor has moved past it, the event
//      says done, and there is no path in the ordinary flow that will ever look
//      at it again. `?backfill=1` ignores the cursor and the event queue and
//      rescans the label directly; the sha256 dedupe is what makes running it
//      at any time harmless. It is also the only reason the five invoices lost
//      to the Content-ID bug were recoverable at all.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { json, error, requireUser } from "@/lib/api";
import { getAccessToken, GmailAuthError } from "@/lib/gmail/auth";
import {
  attachmentsGet,
  getProfile,
  headerValue,
  historyList,
  messagesGet,
  messagesList,
  modifyMessage,
  GmailHistoryGone,
  type GmailMessage,
  type GmailMessagePart,
} from "@/lib/gmail/client";
import { isCronRequest } from "@/lib/gmail/cron";
// Shared with the triage route so the gate and the write path normalise
// domains identically — see lib/gmail/domains.ts.
import {
  domainIsDeclared,
  domainOf,
  normKey,
  parseFromAddress,
} from "@/lib/gmail/domains";
import { extractQueued } from "@/lib/gmail/ingestExtract";
import type { GmailAccount, GmailEvent, SupplierDomain } from "@/types";

export const dynamic = "force-dynamic";
// Same backstop as the extract route, and it stays at the Vercel ceiling. This
// is *not* the working budget — see DRAIN_TIME_BUDGET_MS below. It is the
// hard limit that stops a pathological mailbox running forever.
export const maxDuration = 60;

// ------------------------------------------------------------------
// Caps. Every one of these exists to bound a single invocation.
// ------------------------------------------------------------------
const BUCKET = "invoices";
// Halved (25 → 12) when the schedule moved off Vercel Cron to cron-job.org,
// which closes the connection at 30 seconds. See DRAIN_TIME_BUDGET_MS.
const MAX_EVENTS_PER_ACCOUNT = 12;
/** After five tries a notification is not going to succeed on the sixth. */
const MAX_ATTEMPTS = 5;
const MAX_HISTORY_PAGES = 20;
const MAX_FALLBACK_PAGES = 5;
// Halved (30 → 15) for the same reason.
const MAX_MESSAGES_PER_RUN = 15;

/** How far back a backfill looks when the caller does not say. */
const DEFAULT_SCAN_DAYS = 7;
/** Gmail's `newer_than:` takes a number of days; keep it sane at both ends. */
const MIN_SCAN_DAYS = 1;
const MAX_SCAN_DAYS = 90;

/**
 * Soft wall-clock budget for one invocation.
 *
 * The run is now **partial by design**. Anything left over is picked up by the
 * next run five minutes later, and at 288 runs a day the throughput is far
 * higher than the caps above were ever going to need — so a smaller batch costs
 * nothing, and it turns "slow run" from a *scheduler failure* into an ordinary
 * partial run. That matters because the schedule now lives at cron-job.org,
 * which hangs up at 30 seconds and disables a job outright after 15 consecutive
 * failures; a drain that occasionally takes 35 seconds would quietly switch
 * itself off. 20 seconds leaves room for the in-flight unit of work to finish
 * inside the 30-second window.
 *
 * The check is always at the TOP of an iteration, never mid-way through one:
 * whatever has started always completes. Exceeding it does not abandon a batch
 * — it takes the same route as a failed message, which releases the claimed
 * events and leaves the cursor exactly where it was.
 */
const DRAIN_TIME_BUDGET_MS = 20_000;

// The floor exists to skip junk — logos, signature images, tracking pixels
// that arrive as attachments — NOT to judge an invoice by its size. It was
// 20KB, which silently dropped genuine single-page text-layer invoices from
// small suppliers; those are routinely 6–15KB. Above the ceiling it will not
// fit in memory politely: Gmail returns attachments as base64 inside JSON, so
// a 20MB file is ~27MB before it is decoded, and the decoded copy exists at
// the same time.
const MIN_ATTACHMENT_BYTES = 5 * 1024;
const DEFAULT_MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const ATTACHMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
];

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

/** Same sanitiser the manual upload route uses, so paths look alike. */
function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Strip any `; charset=…` parameter and normalise case. */
function baseMime(value: string | undefined): string {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

/** Gmail historyIds are 64-bit; BigInt is the only safe comparison. */
function maxHistoryId(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  try {
    return BigInt(a) >= BigInt(b) ? a : b;
  } catch {
    return a;
  }
}

interface CandidateAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Is this MIME part an embedded image rather than a real attachment?
 *
 * **Content-ID is not that test, and using it emptied the whole pipeline.**
 * The original version here read `headerValue(part, "content-id") !== null` on
 * the reasoning that an inline image carries a Content-ID and a real attachment
 * does not. The second half is simply false: Gmail's own composer stamps
 * *every* attachment it sends with `Content-ID: <f_…>` and a matching
 * `X-Attachment-Id`, alongside an explicit `Content-Disposition: attachment`.
 * So every PDF sent from a Gmail account — which is every invoice this app was
 * tested with — was classified as an inline logo and silently discarded. The
 * message was then recorded as handled, the cursor advanced and the event
 * marked done, with no error on any screen or in any log. Fourteen
 * notifications, five invoices, nothing filed (updates.md, 2026-08-27).
 *
 * `Content-Disposition` is the header that actually carries the sender's
 * intent, and it is what RFC 2183 defines for exactly this purpose. When it is
 * absent — some mailers omit it — fall back to the old heuristic, but only for
 * images, since that is the case it was really written for: a signature logo
 * referenced by `cid:` from the HTML body. A document with no disposition is
 * kept, because the cost of a stray file in the triage queue is far lower than
 * the cost of dropping an invoice.
 */
function isEmbeddedImage(part: GmailMessagePart, mimeType: string): boolean {
  const disposition = baseMime(headerValue(part, "content-disposition") ?? "");
  if (disposition === "inline") return true;
  if (disposition === "attachment") return false;
  return mimeType.startsWith("image/") && headerValue(part, "content-id") !== null;
}

/**
 * Walk a message's MIME tree and collect the parts worth downloading.
 */
function collectAttachments(
  part: GmailMessagePart | undefined,
  maxBytes: number,
  out: CandidateAttachment[]
): void {
  if (!part) return;

  const attachmentId = part.body?.attachmentId;
  const filename = part.filename?.trim();
  if (attachmentId && filename) {
    const mimeType = baseMime(part.mimeType);
    const size = part.body?.size ?? 0;
    const inline = isEmbeddedImage(part, mimeType);

    if (
      ATTACHMENT_MIME_TYPES.includes(mimeType) &&
      !inline &&
      size >= MIN_ATTACHMENT_BYTES &&
      size <= maxBytes
    ) {
      out.push({ attachmentId, filename, mimeType, size });
    }
  }

  for (const child of part.parts ?? []) collectAttachments(child, maxBytes, out);
}

function receivedAtOf(message: GmailMessage): string | null {
  if (message.internalDate) {
    const ms = Number(message.internalDate);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  const dateHeader = headerValue(message.payload, "date");
  if (dateHeader) {
    const parsed = Date.parse(dateHeader);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return null;
}

// ------------------------------------------------------------------
// Per-account drain
// ------------------------------------------------------------------

interface AccountReport {
  email: string;
  claimed_events: number;
  messages_seen: number;
  uploads_created: number;
  queued_for_extraction: number;
  triaged: number;
  skipped_duplicates: number;
  history_reset: boolean;
  /** True when this account was rescanned on purpose rather than by a 404. */
  backfilled: boolean;
  /** True when the message loop stopped on DRAIN_TIME_BUDGET_MS, not on data. */
  timed_out: boolean;
  errors: string[];
  cursor: string | null;
}

async function drainAccount(
  supabase: SupabaseClient,
  account: GmailAccount,
  config: {
    invoicesLabelId: string;
    processedLabelId: string | null;
    maxBytes: number;
    /** Date.now() past which no *new* message may be started. */
    deadline: number;
    /** Ignore the cursor and the event queue; rescan the label (see note 7). */
    backfill: boolean;
    /** How many days back a backfill or a 404 fallback looks. */
    scanDays: number;
  }
): Promise<AccountReport> {
  const report: AccountReport = {
    email: account.email_address,
    claimed_events: 0,
    messages_seen: 0,
    uploads_created: 0,
    queued_for_extraction: 0,
    triaged: 0,
    skipped_duplicates: 0,
    history_reset: false,
    backfilled: config.backfill,
    timed_out: false,
    errors: [],
    cursor: account.last_history_id,
  };

  // ---- 1. claim pending events (this is the mutex — see note 1) ---------
  //
  // A backfill claims nothing, on purpose. It walks the label instead of the
  // history, so it never covers the window a pending event describes — and an
  // event it claimed and marked done would take that window with it. Leaving
  // the queue alone means the ordinary run five minutes later still handles it,
  // and the dedupe absorbs whatever the two runs both find.
  //
  // Service-role read; scoped by account_id, which carries the user with it.
  const { data: pendingRows } = config.backfill
    ? { data: [] }
    : await supabase
        .from("gmail_events")
        .select("*")
        .eq("account_id", account.id)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(MAX_EVENTS_PER_ACCOUNT);

  const claimed: GmailEvent[] = [];
  for (const row of (pendingRows ?? []) as GmailEvent[]) {
    if (row.attempts >= MAX_ATTEMPTS) {
      await supabase
        .from("gmail_events")
        .update({
          status: "failed",
          error: `Gave up after ${row.attempts} attempts. ${row.error ?? ""}`.trim(),
        })
        .eq("id", row.id);
      continue;
    }

    // The compare-and-swap. `.eq("status", "pending")` is the whole mutex:
    // a second worker's identical update matches no row and returns null.
    const { data: won } = await supabase
      .from("gmail_events")
      .update({ status: "processing", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (won) claimed.push(won as GmailEvent);
  }

  report.claimed_events = claimed.length;
  // A backfill is the one run that has work to do with no event to prompt it —
  // that is the whole point of it (note 7). Every other run stops here.
  if (claimed.length === 0 && !config.backfill) return report;

  /** Put events back where they were, so the next tick retries them. */
  const release = async (message: string) => {
    for (const event of claimed) {
      await supabase
        .from("gmail_events")
        .update({ status: "pending", error: message })
        .eq("id", event.id);
    }
  };

  let accessToken: string;
  try {
    accessToken = await getAccessToken(account.refresh_token);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown error.";
    if (e instanceof GmailAuthError) {
      await supabase
        .from("gmail_accounts")
        .update({ status: "needs_reauth", error: `Gmail drain: ${detail}` })
        .eq("id", account.id);
    }
    await release(`Could not obtain an access token: ${detail}`);
    report.errors.push(detail);
    return report;
  }

  // ---- 2. work out which messages arrived ------------------------------
  const messageIds = new Set<string>();
  let nextCursor: string | null = null;

  try {
    if (config.backfill) {
      // Asked for explicitly. The cursor is not wrong, it is simply not what we
      // want to go by — the mail we are after is *behind* it. Same recovery
      // scan as a pruned cursor, so it takes the same route.
      throw new GmailHistoryGone("(backfill)");
    }

    if (account.last_history_id === null) {
      // No baseline yet — the watch renew has not run, or this mailbox has
      // never been drained. Treated exactly like a pruned cursor.
      throw new GmailHistoryGone("(none)");
    }

    let pageToken: string | undefined;
    for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
      const response = await historyList(accessToken, {
        startHistoryId: account.last_history_id,
        labelId: config.invoicesLabelId,
        // Both types, deliberately — see note 6 at the top of this file.
        historyTypes: ["messageAdded", "labelAdded"],
        pageToken,
      });

      for (const record of response.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          if (messageIds.size < MAX_MESSAGES_PER_RUN) {
            messageIds.add(added.message.id);
          }
        }

        // A label applied after delivery. The entry's own labelIds are the
        // labels that were *added*, so this is where the invoices label is
        // confirmed — the request-level labelId filter is documented as
        // matching on the message's labels, which would also let through the
        // 'processed' label this route adds itself at step 5. Filing our own
        // bookkeeping as a fresh arrival would be harmless (the dedupe absorbs
        // it) but it would mean a pointless download of every attachment we
        // have already read, on every run.
        for (const labelled of record.labelsAdded ?? []) {
          const addedLabels = labelled.labelIds;
          if (addedLabels && !addedLabels.includes(config.invoicesLabelId)) {
            continue;
          }
          if (messageIds.size < MAX_MESSAGES_PER_RUN) {
            messageIds.add(labelled.message.id);
          }
        }
      }

      // The mailbox's history point *now*. Safe to move the cursor to once
      // everything above it has been written.
      nextCursor = response.historyId ?? nextCursor;
      pageToken = response.nextPageToken;
      if (!pageToken) break;
    }
  } catch (e) {
    if (!(e instanceof GmailHistoryGone)) {
      const detail = e instanceof Error ? e.message : "Unknown error.";
      if (e instanceof GmailAuthError) {
        await supabase
          .from("gmail_accounts")
          .update({ status: "needs_reauth", error: `Gmail drain: ${detail}` })
          .eq("id", account.id);
      }
      await release(`History walk failed: ${detail}`);
      report.errors.push(detail);
      return report;
    }

    // ---- the 404 fallback (see note 2) ---------------------------------
    // The cursor is unusable. Scan the invoices label for anything recent that
    // carries an attachment and rebuild the baseline from what we find. Seven
    // days is chosen to match Gmail's own history retention: a longer window
    // would re-walk mail this app has already filed, and the dedupe would
    // absorb it, but at the cost of a great many pointless downloads.
    // Only a genuinely unusable cursor counts as a reset. A backfill reaches
    // this code deliberately, and reporting it as a history reset would make
    // an intentional rescan look like Gmail had pruned the mailbox.
    report.history_reset = !config.backfill;
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_FALLBACK_PAGES; page++) {
        const response = await messagesList(accessToken, {
          labelIds: [config.invoicesLabelId],
          // Deliberately NOT excluding the processed label. A message this app
          // labelled but failed to file is exactly what a backfill is for, and
          // that is not hypothetical — the Content-ID bug (see isEmbeddedImage)
          // stamped five invoices as processed while filing none of them.
          q: `has:attachment newer_than:${config.scanDays}d`,
          pageToken,
        });
        for (const ref of response.messages ?? []) {
          if (messageIds.size < MAX_MESSAGES_PER_RUN) messageIds.add(ref.id);
        }
        pageToken = response.nextPageToken;
        if (!pageToken) break;
      }
    } catch (scanError) {
      const detail =
        scanError instanceof Error ? scanError.message : "Unknown error.";
      await release(`Recent-message scan failed: ${detail}`);
      report.errors.push(detail);
      return report;
    }

    // Re-baseline when the scan found nothing.
    //
    // On this path nextCursor can only come from a message's own historyId
    // (step 4). A quiet week means zero messages, so it would stay null, the
    // cursor would never be written, and the *next* tick would 404 again and
    // do another full seven-day scan — for ever, on every tick. Asking Gmail
    // where the mailbox is now costs one call and ends that.
    // Not on a backfill: that path leaves the cursor alone entirely (step 7),
    // so there is nothing to re-baseline and a profile call would be waste.
    if (messageIds.size === 0 && !config.backfill) {
      try {
        const profile = await getProfile(accessToken);
        nextCursor = maxHistoryId(nextCursor, profile.historyId ?? null);
      } catch (profileError) {
        // Not fatal: the only cost of failing here is that the next tick
        // repeats this scan, which is exactly today's behaviour.
        report.errors.push(
          `Could not re-baseline the cursor: ${
            profileError instanceof Error ? profileError.message : "unknown"
          }`
        );
      }
    }
  }

  // ---- 3. the declared supplier domains, read once ---------------------
  // Service-role read: explicit user_id, because RLS has no auth.uid() here.
  const { data: domainRows } = await supabase
    .from("supplier_domains")
    .select("*")
    .eq("user_id", account.user_id);
  const declaredDomains = ((domainRows ?? []) as SupplierDomain[]).map((d) =>
    normKey(d.domain)
  );

  // ---- 4. each message ------------------------------------------------
  const toExtract: string[] = [];
  const handledMessageIds: string[] = [];
  let anyMessageFailed = false;

  for (const messageId of messageIds) {
    // The time check, at the top of the iteration so a message that has started
    // always finishes. Stopping here is handled at step 7 exactly like a failed
    // message: the events go back to 'pending' and the cursor does not move, so
    // the next run re-walks this same window and the dedupe absorbs the repeat.
    // Nothing is claimed, downloaded or filed out of order because of this.
    if (Date.now() > config.deadline) {
      report.timed_out = true;
      break;
    }

    try {
      const message = await messagesGet(accessToken, messageId);
      report.messages_seen++;

      // A message's historyId is a valid cursor position too, and on the
      // fallback path it is the only one we have.
      nextCursor = maxHistoryId(nextCursor, message.historyId ?? null);

      const candidates: CandidateAttachment[] = [];
      collectAttachments(message.payload, config.maxBytes, candidates);
      if (candidates.length === 0) {
        handledMessageIds.push(messageId);
        continue;
      }

      const fromHeader = headerValue(message.payload, "from");
      const fromAddress = parseFromAddress(fromHeader);
      const subject = headerValue(message.payload, "subject");
      const receivedAt = receivedAtOf(message);
      const domain = domainOf(fromAddress);
      const known = domain !== null && domainIsDeclared(domain, declaredDomains);

      for (const candidate of candidates) {
        // Cheap guard first: have we already pulled this exact attachment off
        // this exact message? Saves the download entirely.
        const { data: seen } = await supabase
          .from("invoice_uploads")
          .select("id")
          .eq("user_id", account.user_id)
          .eq("gmail_message_id", messageId)
          .eq("gmail_attachment_id", candidate.attachmentId)
          .maybeSingle();
        if (seen) {
          report.skipped_duplicates++;
          continue;
        }

        const bytes = await attachmentsGet(
          accessToken,
          messageId,
          candidate.attachmentId
        );
        const fileHash = createHash("sha256").update(bytes).digest("hex");

        // The real dedupe (see note 3): the same bytes, however they arrived.
        const { data: sameBytes } = await supabase
          .from("invoice_uploads")
          .select("id")
          .eq("user_id", account.user_id)
          .eq("file_hash", fileHash)
          .maybeSingle();
        if (sameBytes) {
          report.skipped_duplicates++;
          continue;
        }

        // Same path convention as the manual upload route. The leading
        // `${user_id}/` segment is not cosmetic — the 0010 storage policies key
        // off storage.foldername(name)[1] = auth.uid()::text, so a path that
        // does not start with it is unreadable by the owner in the browser.
        // 'unassigned' because a Gmail-sourced invoice has no project until a
        // human picks one on the review screen.
        const storagePath = `${account.user_id}/unassigned/${Date.now()}-${safeFilename(
          candidate.filename
        )}`;

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, bytes, {
            contentType: candidate.mimeType,
            upsert: false,
          });
        if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

        // Service-role insert: user_id is set explicitly from the account row,
        // because there is no auth.uid() for the RLS policy to supply (R3).
        const { data: inserted, error: insertError } = await supabase
          .from("invoice_uploads")
          .insert({
            user_id: account.user_id,
            project_id: null,
            storage_path: storagePath,
            original_name: candidate.filename,
            mime_type: candidate.mimeType,
            size_bytes: bytes.byteLength,
            // The gate (see note 4): a declared supplier is read automatically,
            // anybody else is held for a human.
            status: known ? "pending" : "needs_triage",
            source_channel: "gmail",
            gmail_message_id: messageId,
            gmail_attachment_id: candidate.attachmentId,
            gmail_thread_id: message.threadId,
            from_address: fromAddress ?? fromHeader,
            subject,
            received_at: receivedAt,
            file_hash: fileHash,
          })
          .select("id")
          .single();

        if (insertError) {
          // 23505 is one of 0013's two unique indexes firing — another worker,
          // or an earlier run, got there first. Not an error; just tidy up the
          // object we uploaded a moment ago and move on.
          await supabase.storage.from(BUCKET).remove([storagePath]);
          if (insertError.code === "23505") {
            report.skipped_duplicates++;
            continue;
          }
          throw new Error(`Could not file the attachment: ${insertError.message}`);
        }

        report.uploads_created++;
        if (known) {
          toExtract.push(inserted.id as string);
          report.queued_for_extraction++;
        } else {
          report.triaged++;
        }
      }

      handledMessageIds.push(messageId);
    } catch (e) {
      // Per-message failure: record it against the events, leave the cursor
      // exactly where it is, and carry on with the next message. One
      // unreadable attachment must not stop the other nineteen.
      anyMessageFailed = true;
      const detail = e instanceof Error ? e.message : "Unknown error.";
      report.errors.push(`${messageId}: ${detail}`);
      for (const event of claimed) {
        await supabase
          .from("gmail_events")
          .update({ error: `Message ${messageId}: ${detail}` })
          .eq("id", event.id);
      }
    }
  }

  // ---- 5. label the messages we handled --------------------------------
  // Cosmetic but worth it: a human looking at the mailbox can see what this
  // has and has not read. Adding a label does not touch the invoices label, so
  // it cannot trigger a fresh notification.
  if (config.processedLabelId) {
    for (const messageId of handledMessageIds) {
      try {
        await modifyMessage(accessToken, messageId, {
          addLabelIds: [config.processedLabelId],
        });
      } catch (e) {
        report.errors.push(
          `Could not label ${messageId}: ${e instanceof Error ? e.message : "unknown"}`
        );
      }
    }
  }

  // ---- 6. extraction, at most three at a time --------------------------
  if (toExtract.length > 0) {
    const outcomes = await extractQueued(supabase, account.user_id, toExtract);
    for (const outcome of outcomes) {
      if (outcome.status === "failed" && outcome.error) {
        report.errors.push(`extract ${outcome.upload_id}: ${outcome.error}`);
      }
    }
  }

  // ---- 7. advance the cursor, last of all (see note 5) -----------------
  // Note that steps 5 and 6 above run even after a time-budget break, and they
  // must: the uploads this run *did* create have to be labelled and extracted
  // now. The next run re-walks the same window, but the dedupe recognises those
  // attachments and skips them, so they would never be queued for extraction a
  // second time and would sit at 'pending' for ever. Finishing them is worth
  // the few seconds it can push the run past 20s — maxDuration is the real
  // ceiling, and 60s still comfortably contains it.
  if (anyMessageFailed || report.timed_out) {
    // Something in this batch did not land — a message failed, or the clock ran
    // out before the rest were looked at. Leave the cursor and let the next run
    // re-walk the same window; the dedupe makes the repeat harmless.
    await release(
      report.timed_out
        ? "Ran out of time this run — the rest will be picked up on the next one."
        : "Part of the batch did not complete — will be retried."
    );
    return report;
  }

  const patch: Record<string, unknown> = { last_drain_at: new Date().toISOString() };

  // A backfill never touches the cursor. It looked at the label, not at the
  // history, so it has no opinion about where the history walk should resume —
  // and the messages it found are older than the cursor by definition, so the
  // only thing writing one here could do is move it *backwards*.
  //
  // maxHistoryId guards that on every other path too, and that guard is not
  // theoretical: on the 404 fallback nextCursor is the newest historyId among
  // the messages the scan happened to find, which can easily be behind a cursor
  // that Gmail refused only because it was pruned. Writing it would re-walk the
  // same window on every tick from then on.
  if (!config.backfill) {
    const advanced = maxHistoryId(nextCursor, account.last_history_id);
    if (advanced) patch.last_history_id = advanced;
  }

  const { error: cursorError } = await supabase
    .from("gmail_accounts")
    .update(patch)
    .eq("id", account.id);

  if (cursorError) {
    await release(`Could not advance the cursor: ${cursorError.message}`);
    report.errors.push(cursorError.message);
    return report;
  }

  report.cursor = (patch.last_history_id as string | undefined) ?? account.last_history_id;

  for (const event of claimed) {
    await supabase
      .from("gmail_events")
      .update({ status: "done", error: null })
      .eq("id", event.id);
  }

  return report;
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------

/**
 * The drain itself. Exported below as **both** GET and POST.
 *
 * A scheduler invokes a path with GET, not POST — this was true of Vercel Cron
 * and is true of cron-job.org, and a POST-only export answers 405 and nothing
 * ever drains. POST is kept because triggering a drain by hand (curl, or the
 * settings screen) is genuinely useful. Both verbs run this same function, and
 * both therefore go through the identical authorisation below: the guard is on
 * the work, not on the verb.
 *
 * Query parameters:
 *   backfill=1  — ignore the cursor and the event queue and rescan the label
 *                 (note 7). Safe at any time; the dedupe makes a repeat a no-op.
 *   days=N      — how far back that scan looks. Default DEFAULT_SCAN_DAYS.
 */
async function handleDrain(req: Request) {
  const startedAt = Date.now();

  // Two callers, two ways of being authorised — the same split as
  // /api/gmail/watch/renew, and for the same reason:
  //
  //   * the five-minute schedule at cron-job.org, which carries CRON_SECRET and
  //     no session, and drains every active mailbox;
  //   * the "Re-scan the mailbox" button on /settings, which carries a session
  //     and no secret, and may only touch its own mailboxes.
  //
  // This route runs service-role, so a signed-in request is pinned to that
  // user's accounts below. Without the pin the button would drain other
  // people's mailboxes.
  let onlyUserId: string | null = null;
  if (!isCronRequest(req)) {
    const auth = await requireUser();
    if ("response" in auth) return auth.response;
    onlyUserId = auth.user.id;
  }

  const params = new URL(req.url).searchParams;
  const backfill = params.get("backfill") === "1";
  const parsedDays = Number(params.get("days"));
  const scanDays =
    Number.isFinite(parsedDays) && parsedDays >= MIN_SCAN_DAYS
      ? Math.min(Math.floor(parsedDays), MAX_SCAN_DAYS)
      : DEFAULT_SCAN_DAYS;

  const invoicesLabelId = process.env.GMAIL_INVOICES_LABEL_ID;
  if (!invoicesLabelId)
    return error(
      "GMAIL_INVOICES_LABEL_ID is not set — there is no label to drain.",
      500
    );

  const parsedMax = Number(process.env.GMAIL_MAX_ATTACHMENT_BYTES);
  const maxBytes =
    Number.isFinite(parsedMax) && parsedMax > MIN_ATTACHMENT_BYTES
      ? parsedMax
      : DEFAULT_MAX_ATTACHMENT_BYTES;

  const deadline = startedAt + DRAIN_TIME_BUDGET_MS;
  const config = {
    invoicesLabelId,
    processedLabelId: process.env.GMAIL_PROCESSED_LABEL_ID ?? null,
    maxBytes,
    deadline,
    backfill,
    scanDays,
  };

  // Service-role client: no session on a cron request, so RLS has no
  // auth.uid() to scope by (R3 exception — see the banner at the top).
  const supabase = createServiceClient();

  let query = supabase.from("gmail_accounts").select("*").eq("status", "active");
  // Not an R3 violation: the service client has no auth.uid() for RLS to use,
  // so a session-initiated call has to say whose mailboxes it means.
  if (onlyUserId) query = query.eq("user_id", onlyUserId);

  const { data: rows, error: readError } = await query;
  if (readError) return error(readError.message, 500);

  const accounts = (rows ?? []) as GmailAccount[];
  const reports: AccountReport[] = [];
  let partial = false;

  for (const account of accounts) {
    // Top-of-iteration time check, same rule as the message loop: a mailbox
    // that has been started is always finished. One skipped here is simply not
    // touched at all — its events stay 'pending' and the next run claims them.
    if (Date.now() > deadline) {
      partial = true;
      break;
    }

    try {
      reports.push(await drainAccount(supabase, account, config));
    } catch (e) {
      // A whole-account failure must not stop the other mailboxes. In practice
      // there is one.
      const detail = e instanceof Error ? e.message : "Unknown error.";
      console.error(`[gmail drain] ${account.email_address}:`, detail);
      reports.push({
        email: account.email_address,
        claimed_events: 0,
        messages_seen: 0,
        uploads_created: 0,
        queued_for_extraction: 0,
        triaged: 0,
        skipped_duplicates: 0,
        history_reset: false,
        backfilled: backfill,
        timed_out: false,
        errors: [detail],
        cursor: account.last_history_id,
      });
    }
  }

  if (reports.some((r) => r.timed_out)) partial = true;

  // How much is still waiting. One cheap count, and the only number that says
  // whether the schedule is keeping up — the invoices screen shows the same
  // figure to the user (components/invoices/DrainHealth.tsx).
  // Service-role count; there is no auth.uid() to scope by (R3 exception).
  const { count: eventsRemaining } = await supabase
    .from("gmail_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // The full per-account detail goes to the Vercel log, not down the wire. The
  // response body has to stay small: cron-job.org keeps only the first 64KB of
  // it, and an `errors` array grows with every message that misbehaves.
  //
  // Logged on *every* run, not only failing ones. It used to be errors-only,
  // and that is precisely why the labelAdded bug in note 6 went unnoticed for
  // seven invoices: those runs were textbook successes — one attempt each, no
  // errors, events marked done — and they printed nothing at all. A drain that
  // says nothing when it finds nothing is indistinguishable from a drain that
  // is working, and the difference is the whole point of reading the log.
  const errorCount = reports.reduce((n, r) => n + r.errors.length, 0);
  const logLine = ["[gmail drain]", JSON.stringify(reports)] as const;
  if (errorCount > 0) console.error(...logLine);
  else console.log(...logLine);

  const sum = (pick: (r: AccountReport) => number) =>
    reports.reduce((n, r) => n + pick(r), 0);

  return json({
    ok: errorCount === 0,
    backfill,
    ...(backfill ? { scanDays } : {}),
    accountsProcessed: reports.length,
    eventsProcessed: sum((r) => r.claimed_events),
    // The four below are what turn "nothing appeared" into a diagnosis, and
    // they are the reason this body is worth reading by hand. messagesSeen = 0
    // with events processed means the history walk matched nothing; messagesSeen
    // above 0 with uploadsCreated 0 means every attachment was rejected by the
    // MIME/size filter in collectAttachments. Counts only, so the 64KB ceiling
    // is in no danger.
    messagesSeen: sum((r) => r.messages_seen),
    uploadsCreated: sum((r) => r.uploads_created),
    queuedForExtraction: sum((r) => r.queued_for_extraction),
    triaged: sum((r) => r.triaged),
    skippedDuplicates: sum((r) => r.skipped_duplicates),
    historyReset: reports.some((r) => r.history_reset),
    eventsRemaining: eventsRemaining ?? null,
    errors: errorCount,
    partial,
    ms: Date.now() - startedAt,
  });
}

export const GET = handleDrain;
export const POST = handleDrain;
