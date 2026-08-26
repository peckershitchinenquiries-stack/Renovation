// Thin typed wrappers over the Gmail REST API. No business logic lives here —
// every function is one HTTP call, its parameters, and its response shape.
// Deciding *what* to fetch is app/api/gmail/drain/route.ts's job; this file
// only knows how to ask.
//
// Dependency-free for the same reason lib/gmail/auth.ts is: these are six
// documented GETs and POSTs, which is less code than wiring up googleapis and
// far easier to read the whole of.
//
// **Server-only.** Every function takes an access token minted by
// getAccessToken() in lib/gmail/auth.ts. Nothing here reads the environment
// and nothing here touches the database.
//
// The error taxonomy below is the part that matters. Callers act on the class,
// never on the message:
//
//   GmailAuthError      — the credential is dead. Set the account to
//                         'needs_reauth'; retrying will not help. (Re-used
//                         from lib/gmail/auth.ts so there is one such class.)
//   GmailHistoryGone    — history.list returned 404: the start historyId is
//                         older than Gmail's retention window. Not an error
//                         so much as a fact — the drain falls back to a recent
//                         message scan. This *will* happen; see the drain.
//   GmailApiError       — everything else, carrying `status` and `retryable`.
//                         retryable means 429/5xx: leave the work where it is
//                         and let the next cron tick have another go.

import { GmailAuthError } from "@/lib/gmail/auth";

const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// ============================================================
// Errors
// ============================================================

/** A 404 from history.list — the cursor is older than Gmail will serve. */
export class GmailHistoryGone extends Error {
  constructor(readonly startHistoryId: string) {
    super(
      `Gmail no longer holds history from ${startHistoryId} — the cursor is too old to resume from.`
    );
    this.name = "GmailHistoryGone";
  }
}

/** Any other non-2xx from the Gmail API. */
export class GmailApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 429 and 5xx only. A retryable failure must not fail an event. */
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

// ============================================================
// Response shapes
// ============================================================
// Only the fields this project actually reads are declared. Gmail returns a
// great deal more and none of it is our business.

export interface GmailHeader {
  name: string;
  value: string;
}

/** One node of a message's MIME tree. `parts` makes this recursive. */
export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  /** Present and non-empty on an attachment; absent on a body part. */
  filename?: string;
  headers?: GmailHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  /** The mailbox history point this message sits at. */
  historyId?: string;
  /** Epoch milliseconds, as a string. Gmail's own idea of when it arrived. */
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: { message: GmailMessageRef & { labelIds?: string[] } }[];
}

export interface GmailHistoryListResponse {
  history?: GmailHistoryRecord[];
  nextPageToken?: string;
  /** The mailbox's history point *now* — the safe place to move a cursor to. */
  historyId?: string;
}

export interface GmailMessagesListResponse {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailWatchResponse {
  /** Baseline cursor. Only meaningful on the very first watch of a mailbox. */
  historyId: string;
  /** Epoch milliseconds, as a string. Gmail expires a watch after 7 days. */
  expiration: string;
}

// ============================================================
// The one HTTP call everything goes through
// ============================================================

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string }[];
  };
}

async function call<T>(
  accessToken: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });

  if (res.ok) return (await res.json()) as T;

  // Read the body for a usable message, but never let a malformed error body
  // turn into a different, more confusing error than the one Gmail sent.
  let body: GoogleErrorBody = {};
  try {
    body = (await res.json()) as GoogleErrorBody;
  } catch {
    /* Google returned HTML or nothing. res.status is still the truth. */
  }
  const detail = body.error?.message ?? res.statusText ?? "no detail";

  // 401 means the access token is not acceptable. Since it was minted seconds
  // ago from the refresh token, the credential itself is what is wrong.
  if (res.status === 401) {
    throw new GmailAuthError(`Gmail rejected the credential: ${detail}`);
  }

  // 403 is ambiguous: it is both "you have not granted this scope" and
  // "you are over quota". Only the latter is worth retrying.
  if (res.status === 403) {
    const reason = body.error?.errors?.[0]?.reason ?? "";
    const isQuota =
      reason.includes("Limit") ||
      reason.includes("rateLimit") ||
      reason === "userRateLimitExceeded";
    if (isQuota) {
      throw new GmailApiError(`Gmail quota exceeded: ${detail}`, 403, true);
    }
    throw new GmailAuthError(`Gmail refused the request: ${detail}`);
  }

  const retryable = res.status === 429 || res.status >= 500;
  throw new GmailApiError(
    `Gmail API ${path} failed (${res.status}): ${detail}`,
    res.status,
    retryable
  );
}

// ============================================================
// users.watch
// ============================================================

/**
 * Ask Gmail to publish a notification to a Pub/Sub topic whenever the mailbox
 * changes.
 *
 * `labelIds` is the whole reason this endpoint is worth using rather than
 * polling: the filter is applied at Gmail's end, so ordinary mail never wakes
 * the push endpoint at all. Without it every newsletter would cost a
 * notification, a database write and a history walk.
 *
 * Idempotent — calling it again on a mailbox that is already watched simply
 * renews. The watch expires after seven days regardless, which is why the
 * renew route runs daily rather than once.
 */
export async function watch(
  accessToken: string,
  opts: { topicName: string; labelIds?: string[] }
): Promise<GmailWatchResponse> {
  return call<GmailWatchResponse>(accessToken, "/watch", {
    method: "POST",
    body: {
      topicName: opts.topicName,
      ...(opts.labelIds?.length
        ? { labelIds: opts.labelIds, labelFilterBehavior: "include" }
        : {}),
    },
  });
}

/** Stop a watch. Not used by the cron, but the counterpart belongs here. */
export async function stopWatch(accessToken: string): Promise<void> {
  await call<unknown>(accessToken, "/stop", { method: "POST" });
}

// ============================================================
// history.list
// ============================================================

/**
 * What changed since `startHistoryId`.
 *
 * Throws GmailHistoryGone on a 404. That is a routine outcome, not a bug: a
 * cursor older than Gmail's retention window (roughly a week, and shorter on a
 * busy mailbox) cannot be resumed from, and the caller has to rebuild its
 * baseline some other way.
 */
export async function historyList(
  accessToken: string,
  opts: {
    startHistoryId: string;
    labelId?: string;
    pageToken?: string;
    /** Defaults to messageAdded — arrivals are all this project cares about. */
    historyTypes?: string[];
  }
): Promise<GmailHistoryListResponse> {
  const params = new URLSearchParams({ startHistoryId: opts.startHistoryId });
  for (const t of opts.historyTypes ?? ["messageAdded"])
    params.append("historyTypes", t);
  if (opts.labelId) params.set("labelId", opts.labelId);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  try {
    return await call<GmailHistoryListResponse>(
      accessToken,
      `/history?${params.toString()}`
    );
  } catch (e) {
    if (e instanceof GmailApiError && e.status === 404) {
      throw new GmailHistoryGone(opts.startHistoryId);
    }
    throw e;
  }
}

// ============================================================
// messages.list / messages.get
// ============================================================

/**
 * Search the mailbox. `labelIds` is preferred over a `label:` term in `q`
 * because the app holds label *ids* — `q` wants the display name, and a label
 * the owner renames would silently stop matching.
 */
export async function messagesList(
  accessToken: string,
  opts: {
    q?: string;
    labelIds?: string[];
    pageToken?: string;
    maxResults?: number;
  }
): Promise<GmailMessagesListResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set("q", opts.q);
  for (const id of opts.labelIds ?? []) params.append("labelIds", id);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));

  return call<GmailMessagesListResponse>(
    accessToken,
    `/messages?${params.toString()}`
  );
}

/**
 * One whole message, headers and MIME tree included.
 *
 * `format=full` returns the structure and every part's metadata but *not* the
 * attachment bytes — those carry an `attachmentId` to be fetched separately.
 * That is deliberate on Gmail's part and convenient on ours: it is what lets
 * the drain decide whether an attachment is worth downloading before it
 * downloads it.
 */
export async function messagesGet(
  accessToken: string,
  id: string
): Promise<GmailMessage> {
  return call<GmailMessage>(
    accessToken,
    `/messages/${encodeURIComponent(id)}?format=full`
  );
}

// ============================================================
// attachments.get
// ============================================================

interface AttachmentBody {
  size?: number;
  /** base64url, per the API docs — not standard base64. */
  data?: string;
}

/**
 * Download one attachment's bytes.
 *
 * Gmail returns base64url-encoded JSON, so the wire cost is roughly 4/3 of the
 * file and the decode happens here rather than leaking an encoding detail into
 * the caller. A 20MB attachment is ~27MB of JSON in memory before this
 * function returns — which is precisely why the drain enforces a ceiling on
 * `body.size` *before* calling this.
 */
export async function attachmentsGet(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer> {
  const body = await call<AttachmentBody>(
    accessToken,
    `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(
      attachmentId
    )}`
  );
  if (!body.data) {
    throw new GmailApiError(
      `Attachment ${attachmentId} on message ${messageId} came back empty.`,
      200,
      false
    );
  }
  return Buffer.from(body.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// ============================================================
// messages.modify
// ============================================================

/**
 * Add or remove labels on a message. Used to stamp a handled message with the
 * Processed label, which is what makes a re-drain visibly a no-op to a human
 * looking at the mailbox.
 *
 * Requires the gmail.modify scope, which lib/gmail/auth.ts already asks for.
 */
export async function modifyMessage(
  accessToken: string,
  id: string,
  opts: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await call<unknown>(
    accessToken,
    `/messages/${encodeURIComponent(id)}/modify`,
    {
      method: "POST",
      body: {
        addLabelIds: opts.addLabelIds ?? [],
        removeLabelIds: opts.removeLabelIds ?? [],
      },
    }
  );
}

// ============================================================
// Header helper
// ============================================================

/** Case-insensitive header lookup — Gmail's casing is not guaranteed. */
export function headerValue(
  part: GmailMessagePart | undefined,
  name: string
): string | null {
  const want = name.toLowerCase();
  const hit = part?.headers?.find((h) => h.name.toLowerCase() === want);
  return hit?.value ?? null;
}
