// The Gmail section of /settings — status, a Connect link, and a way to
// register the watch by hand.
//
// Still a Server Component: connecting is a plain link to a Route Handler that
// redirects to Google, so it needs no client JavaScript. The one exception is
// RenewWatchButton, a small client island, because re-registering the watch is
// a POST and wants a Toast.
import { createClient } from "@/lib/supabase/server";
import RenewWatchButton from "./RenewWatchButton";
import RescanMailboxButton from "./RescanMailboxButton";
import { SectionHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { IconTile } from "@/components/ui/List";
import { EmptyState } from "@/components/ui/States";
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

const STATUS_DOT: Record<GmailAccount["status"], string> = {
  active: "bg-emerald-500",
  needs_reauth: "bg-red-500",
  paused: "bg-gray-400",
};

const STATUS_TEXT: Record<GmailAccount["status"], string> = {
  active: "text-emerald-700",
  needs_reauth: "text-red-600",
  paused: "text-gray-500",
};

/** One coloured advisory strip. Three of these used three different styles. */
function Notice({
  tone,
  children,
}: {
  tone: "good" | "bad" | "warn";
  children: React.ReactNode;
}) {
  const style =
    tone === "good"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-600/15"
      : tone === "bad"
        ? "bg-red-50 text-red-700 ring-red-600/15"
        : "bg-amber-50 text-amber-900 ring-amber-600/15";
  const icon = tone === "good" ? "check" : tone === "bad" ? "alert" : "info";
  return (
    <div
      className={`mb-3 flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[0.8125rem] leading-relaxed ring-1 ring-inset ${style}`}
    >
      <Icon name={icon} size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

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

  // No .eq("user_id", …) — RLS scopes this (R3). Since 0015 that means every
  // mailbox connected by anyone in the shared workspace, not just this
  // person's: the list is already a list, so it renders them all.
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
    <section>
      <SectionHeader
        title="Gmail"
        hint="Read supplier invoices straight out of a mailbox"
      />

      {connected ? <Notice tone="good">Connected {connected}.</Notice> : null}
      {errorMessage ? <Notice tone="bad">{errorMessage}</Notice> : null}
      {/* Connected, but no Pub/Sub subscription — so no email would ever
          arrive. Surfaced next to the button that fixes it. */}
      {watchFailed ? (
        <Notice tone="warn">
          The mailbox is connected, but the Gmail watch could not be registered,
          so no email will arrive yet. Press{" "}
          <strong className="font-bold">Register / refresh watch</strong> below
          to try again.
          {watchError ? (
            <span className="mt-1 block text-xs opacity-80">{watchError}</span>
          ) : null}
        </Notice>
      ) : null}

      {tableMissing ? (
        <div className="card">
          <p className="text-sm leading-relaxed text-gray-500">
            Not available yet — migration{" "}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
              0013_gmail_ingest.sql
            </code>{" "}
            has not been run in the Supabase SQL editor.
          </p>
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="mail"
          compact
          title="No mailbox connected"
          description="Connect one and invoices emailed by suppliers are read automatically."
          action={
            <a href="/api/gmail/connect" className="btn-primary">
              <Icon name="mail" size={18} />
              Connect Gmail
            </a>
          }
        />
      ) : (
        <>
          <div className="card-flush row-divide">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-start gap-3 px-4 py-3.5">
                <IconTile
                  name="mail"
                  tone={a.status === "active" ? "good" : a.status === "needs_reauth" ? "bad" : "neutral"}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.9375rem] font-semibold text-gray-900">
                    {a.email_address}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[a.status]}`}
                    />
                    <span className={`font-semibold ${STATUS_TEXT[a.status]}`}>
                      {STATUS_LABEL[a.status]}
                    </span>
                    <span className="text-gray-400">
                      · last email {age(a.last_notification_at)}
                    </span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {a.watch_expiration
                      ? `Watch expires ${new Date(
                          a.watch_expiration
                        ).toLocaleString("en-GB")}`
                      : "No watch registered — nothing will arrive until there is one."}
                  </p>
                  {a.error ? (
                    <p className="mt-1 text-xs text-red-600">{a.error}</p>
                  ) : null}
                </div>
                <a
                  href="/api/gmail/connect"
                  className="btn-ghost btn-sm shrink-0 text-brand-700"
                >
                  Reconnect
                </a>
              </div>
            ))}
          </div>

          {/* One button each for the section, not one per row: both act on every
              mailbox this user has connected. Each carries its own explanation
              underneath rather than beside it — a sentence squeezed next to a
              button wraps to three words per line on a phone. */}
          <div className="mt-3 space-y-3">
            <div className="card">
              <RenewWatchButton />
              <p className="hint">
                Registers the Gmail watch now. Needed if it failed while
                connecting, and harmless at any other time.
              </p>
            </div>
            <div className="card">
              <RescanMailboxButton />
              <p className="hint">
                Reads the invoices label again from the last 30 days. Use it when
                an email arrived in Gmail but never appeared on the invoices
                screen. Anything already read is skipped.
              </p>
            </div>
          </div>
        </>
      )}

      <p className="hint mt-2.5">
        While the Google consent screen is in Testing mode the connection expires
        after seven days and has to be reconnected.
      </p>
    </section>
  );
}
