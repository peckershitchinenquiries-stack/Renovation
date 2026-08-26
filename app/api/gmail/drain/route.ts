// POST /api/gmail/drain — turn recorded notifications into invoice_uploads rows.
//
// The other half of the split described in app/api/gmail/push/route.ts. The
// push endpoint acks in milliseconds and writes a gmail_events row; this does
// the slow part on a five-minute cron: walk the mailbox's history, pull down
// the attachments, put them in Storage, and file a row for each one.
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

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import { json, error } from "@/lib/api";
import { getAccessToken, GmailAuthError } from "@/lib/gmail/auth";
import {
  attachmentsGet,
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
import { extractQueued } from "@/lib/gmail/ingestExtract";
import type { GmailAccount, GmailEvent, SupplierDomain } from "@/types";

export const dynamic = "force-dynamic";
// Same budget as the extract route. The work is bounded by the caps below
// rather than by the clock, but a pathological mailbox should not run forever.
export const maxDuration = 60;

// ------------------------------------------------------------------
// Caps. Every one of these exists to bound a single invocation.
// ------------------------------------------------------------------
const BUCKET = "invoices";
const MAX_EVENTS_PER_ACCOUNT = 25;
/** After five tries a notification is not going to succeed on the sixth. */
const MAX_ATTEMPTS = 5;
const MAX_HISTORY_PAGES = 20;
const MAX_FALLBACK_PAGES = 5;
const MAX_MESSAGES_PER_RUN = 30;

// Below 20KB it is a logo, a signature image or a tracking pixel, not an
// invoice. Above the ceiling it will not fit in memory politely: Gmail returns
// attachments as base64 inside JSON, so a 20MB file is ~27MB before it is
// decoded, and the decoded copy exists at the same time.
const MIN_ATTACHMENT_BYTES = 20 * 1024;
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

/**
 * The JavaScript twin of public.norm_key(): trim, lower-case, collapse
 * internal whitespace. Same rule as priceKey() and normaliseName() — all four
 * must stay in step or the database and the app disagree about what one
 * domain is (about.md §4).
 */
function normKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** `"Selco <sales@selco.co.uk>"` → `"sales@selco.co.uk"`. */
function parseFromAddress(header: string | null): string | null {
  if (!header) return null;
  const angled = header.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : header).trim();
  return candidate.includes("@") ? candidate : null;
}

function domainOf(address: string | null): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normKey(address.slice(at + 1).replace(/[>\s]+$/, ""));
  return domain || null;
}

/**
 * Is this sender a declared supplier?
 *
 * Sub-domains count: a supplier whose invoices come from
 * `billing.mail.selco.co.uk` is still Selco, and making the owner declare every
 * sending sub-domain would mean invoices silently landing in triage until they
 * noticed. The match requires a `.` boundary, so `notselco.co.uk` does not
 * match `selco.co.uk` — and a declared `selco.co.uk` can never be satisfied by
 * something merely *containing* it.
 */
function domainIsDeclared(domain: string, declared: string[]): boolean {
  return declared.some((d) => domain === d || domain.endsWith(`.${d}`));
}

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
 * Walk a message's MIME tree and collect the parts worth downloading.
 *
 * The Content-ID test is what keeps a supplier's signature logo out of the
 * review queue: an inline image carries one, a real attachment does not.
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
    const inline = headerValue(part, "content-id") !== null;

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
  errors: string[];
  cursor: string | null;
}

async function drainAccount(
  supabase: SupabaseClient,
  account: GmailAccount,
  config: { invoicesLabelId: string; processedLabelId: string | null; maxBytes: number }
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
    errors: [],
    cursor: account.last_history_id,
  };

  // ---- 1. claim pending events (this is the mutex — see note 1) ---------
  // Service-role read; scoped by account_id, which carries the user with it.
  const { data: pendingRows } = await supabase
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
  if (claimed.length === 0) return report;

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
        historyTypes: ["messageAdded"],
        pageToken,
      });

      for (const record of response.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          if (messageIds.size < MAX_MESSAGES_PER_RUN) {
            messageIds.add(added.message.id);
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
    report.history_reset = true;
    try {
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_FALLBACK_PAGES; page++) {
        const response = await messagesList(accessToken, {
          labelIds: [config.invoicesLabelId],
          q: "has:attachment newer_than:7d",
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
  if (anyMessageFailed) {
    // Something in this batch did not land. Leave the cursor and let the next
    // tick re-walk the same window; the dedupe makes the repeat harmless.
    await release("Part of the batch did not complete — will be retried.");
    return report;
  }

  const patch: Record<string, unknown> = { last_drain_at: new Date().toISOString() };
  if (nextCursor) patch.last_history_id = nextCursor;

  const { error: cursorError } = await supabase
    .from("gmail_accounts")
    .update(patch)
    .eq("id", account.id);

  if (cursorError) {
    await release(`Could not advance the cursor: ${cursorError.message}`);
    report.errors.push(cursorError.message);
    return report;
  }

  report.cursor = nextCursor ?? account.last_history_id;

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

export async function POST(req: Request) {
  if (!isCronRequest(req)) return error("Not authorised", 401);

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

  const config = {
    invoicesLabelId,
    processedLabelId: process.env.GMAIL_PROCESSED_LABEL_ID ?? null,
    maxBytes,
  };

  // Service-role client: no session on a cron request, so RLS has no
  // auth.uid() to scope by (R3 exception — see the banner at the top).
  const supabase = createServiceClient();

  const { data: rows, error: readError } = await supabase
    .from("gmail_accounts")
    .select("*")
    .eq("status", "active");
  if (readError) return error(readError.message, 500);

  const accounts = (rows ?? []) as GmailAccount[];
  const reports: AccountReport[] = [];

  for (const account of accounts) {
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
        errors: [detail],
        cursor: account.last_history_id,
      });
    }
  }

  return json({ accounts: accounts.length, reports });
}
