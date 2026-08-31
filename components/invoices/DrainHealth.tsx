// "Has the drain stopped?" — on /invoices, above the triage queue.
//
// Why this exists
// ---------------
// The settings screen already shows a heartbeat (components/settings/
// GmailSection.tsx: last email …, watch expires …). That answers a different
// question: is Gmail still *sending* us notifications. It says nothing about
// whether anything is *reading* them.
//
// Since the five-minute drain moved off Vercel Cron to cron-job.org (Hobby
// allows daily crons only — see app/api/gmail/drain/route.ts), that gap became
// a real failure mode. cron-job.org disables a job automatically after 15
// consecutive failures, and it does so silently as far as this app is
// concerned. Everything else would keep working: mail arrives, Pub/Sub pushes,
// gmail_events rows are written — and then nothing ever drains them. Invoices
// would simply stop appearing, with no error anywhere on any screen.
//
// A pending gmail_events row is exactly the evidence. One that is minutes old
// is normal; one that is half an hour old means nothing has run.
//
// Quiet by design, like TriageSection beside it: no pending rows renders
// nothing at all.

import { createClient } from "@/lib/supabase/server";
import { Icon } from "@/components/ui/Icon";

/**
 * Past this, the schedule is not merely late — it has stopped.
 *
 * The drain runs every five minutes, so a pending row should never survive two
 * runs. Twenty minutes is four missed runs: comfortably outside a slow run, a
 * cold start or a single transient failure, and well inside the fifteen
 * consecutive failures it takes cron-job.org to disable the job.
 */
const STALE_AFTER_MS = 20 * 60 * 1000;

function minutesAgo(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

/** "43 min" / "2 hr 5 min" / "3 days" — an age, not a date. */
function ageLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  }
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

export default async function DrainHealth() {
  const supabase = createClient();

  // No .eq("user_id", …) — RLS scopes this (R3). The "shared workspace" policy
  // from 0015 is what makes this readable through the ordinary server client,
  // which is why this does not need the service role the drain itself uses.
  // Since 0015 that scope is "everyone signed in", so this panel shows the
  // health of the whole workspace's queue, not one person's.
  //
  // One query does both jobs: `count` is every pending row, and the single
  // returned row is the oldest of them. idx_gmail_events_status_created covers
  // exactly this shape.
  const { data, error, count } = await supabase
    .from("gmail_events")
    .select("created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);

  // Migration 0013 is pasted in by hand, so the table may not exist yet. Stay
  // silent rather than breaking a screen someone came here to upload on.
  if (error || !data || data.length === 0) return null;

  const pending = count ?? data.length;
  if (pending === 0) return null;

  const minutes = minutesAgo(data[0].created_at as string);
  const stale = Date.now() - Date.parse(data[0].created_at as string) > STALE_AFTER_MS;
  const emails = pending === 1 ? "email" : "emails";

  // One banner, deliberately outside the mobile/desktop split that TriageSection
  // uses below. It is a single sentence, not a list of rows, so it needs no
  // separate card and table rendering — it wraps and is legible at every width,
  // and there is no second render path it can go missing from.
  return (
    <div
      role="status"
      className={`mb-4 flex items-start gap-2.5 rounded-2xl px-4 py-3 text-[0.8125rem]
        leading-relaxed ring-1 ring-inset ${
          stale
            ? "bg-amber-50 text-amber-900 ring-amber-600/15"
            : "bg-gray-100 text-gray-600 ring-gray-500/10"
        }`}
    >
      <Icon
        name={stale ? "alert" : "clock"}
        size={17}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        {stale ? (
          <>
            <span className="font-bold">
              {pending} unprocessed {emails}, oldest {ageLabel(minutes)} ago
            </span>{" "}
            — the drain scheduler may have stopped. Check the scheduled job that
            calls{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
              /api/gmail/drain
            </code>{" "}
            is still enabled.
          </>
        ) : (
          <>
            {pending} {emails} waiting to be read, oldest {ageLabel(minutes)}{" "}
            ago. These are picked up automatically within a few minutes.
          </>
        )}
      </div>
    </div>
  );
}
