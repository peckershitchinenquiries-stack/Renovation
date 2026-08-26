// The Gmail section of /settings — status, a Connect link, and a way to
// register the watch by hand.
//
// Still a Server Component: connecting is a plain link to a Route Handler that
// redirects to Google, so it needs no client JavaScript. The one exception is
// RenewWatchButton, a small client island, because re-registering the watch is
// a POST and wants a Toast.
import { createClient } from "@/lib/supabase/server";
import RenewWatchButton from "./RenewWatchButton";
import type { GmailAccount } from "@/types";

// Rendered as an age rather than a timestamp because the only question this
// answers is "is ingestion still alive?" — "3 hours ago" says that, and
// "14/08/2026, 09:12" makes you work it out.
function age(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const STATUS_LABEL: Record<GmailAccount["status"], string> = {
  active: "Active",
  needs_reauth: "Needs reconnecting",
  paused: "Paused",
};

const STATUS_CLASS: Record<GmailAccount["status"], string> = {
  active: "text-green-700",
  needs_reauth: "text-red-600",
  paused: "text-gray-500",
};

export default async function GmailSection({
  connected,
  errorMessage,
  watchFailed,
  watchError,
}: {
  connected?: string;
  errorMessage?: string;
  // The callback connected the mailbox but could not register the watch. Said
  // out loud rather than swallowed: the connection looks fine in every other
  // respect, and the only symptom is that no email ever arrives.
  watchFailed?: boolean;
  watchError?: string;
}) {
  const supabase = createClient();

  // No .eq("user_id", …) — RLS scopes this to the signed-in user (R3).
  const { data, error } = await supabase
    .from("gmail_accounts")
    .select("*")
    .order("created_at", { ascending: true });

  // Migration 0013 is run by hand, so until someone pastes it into the SQL
  // editor this table does not exist. Say that plainly instead of crashing
  // the whole settings page.
  const tableMissing = Boolean(error);
  const accounts = (data ?? []) as GmailAccount[];

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-lg font-semibold text-gray-900">Gmail</h2>
      <p className="mb-3 text-sm text-gray-500">
        Connect a mailbox so supplier invoices sent by email can be read without
        being downloaded and re-uploaded by hand.
      </p>

      {connected && (
        <p className="mb-3 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Connected {connected}.
        </p>
      )}
      {errorMessage && (
        <p className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
      {/* Connected, but no Pub/Sub subscription — so no email would ever
          arrive. Surfaced next to the button that fixes it. */}
      {watchFailed && (
        <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          The mailbox is connected, but the Gmail watch could not be
          registered, so no email will arrive yet. Press{" "}
          <strong>Register / refresh watch</strong> below to try again.
          {watchError && (
            <span className="mt-1 block text-xs text-amber-700">
              {watchError}
            </span>
          )}
        </p>
      )}

      <div className="card">
        {tableMissing ? (
          <p className="text-sm text-gray-500">
            Not available yet — migration{" "}
            <code className="text-xs">0013_gmail_ingest.sql</code> has not been
            run in the Supabase SQL editor.
          </p>
        ) : accounts.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-gray-500">No mailbox connected.</p>
            <a href="/api/gmail/connect" className="btn-primary">
              Connect Gmail
            </a>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {accounts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {a.email_address}
                  </p>
                  <p className="text-xs text-gray-500">
                    <span className={STATUS_CLASS[a.status]}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    {" · last email "}
                    {age(a.last_notification_at)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {a.watch_expiration
                      ? `Watch expires ${new Date(
                          a.watch_expiration
                        ).toLocaleString("en-GB")}`
                      : "No watch registered — nothing will arrive until there is one."}
                  </p>
                  {a.error && (
                    <p className="mt-1 text-xs text-red-600">{a.error}</p>
                  )}
                </div>
                <a
                  href="/api/gmail/connect"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Reconnect
                </a>
              </li>
            ))}
          </ul>
        )}

        {/* One button for the section, not one per row: it renews every
            mailbox this user has connected. */}
        {!tableMissing && accounts.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
            <RenewWatchButton />
            <span className="text-xs text-gray-500">
              Registers the Gmail watch now. Needed if it failed while
              connecting, and harmless at any other time.
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        While the Google consent screen is in Testing mode the connection
        expires after seven days and has to be reconnected.
      </p>
    </section>
  );
}
