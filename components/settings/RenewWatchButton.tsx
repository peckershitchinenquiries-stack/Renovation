"use client";

// The "Register / refresh watch" button in the Gmail section of /settings.
//
// A Gmail watch is what makes push notifications happen at all, and it expires
// after seven days. The OAuth callback registers one, and a daily cron renews
// it — but when either of those fails there was previously no way to try again
// short of disconnecting and reconnecting the whole mailbox. This is that way.
//
// No new route: it POSTs to /api/gmail/watch/renew, the same handler the cron
// GETs. That route accepts a signed-in caller as well as a cron one, and pins
// a signed-in call to that user's own mailboxes.
//
// GmailSection is a Server Component, so this is the one client island in it —
// which is why it is a separate file rather than a "use client" on the section.

import { useState } from "react";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";
import { useRouter } from "next/navigation";

interface RenewResult {
  email: string;
  outcome: "renewed" | "needs_reauth" | "error" | "skipped";
  detail: string;
}

export default function RenewWatchButton() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();

  async function run() {
    setBusy(true);
    try {
      const data = await apiFetch<{ accounts: number; results: RenewResult[] }>(
        "/api/gmail/watch/renew",
        { method: "POST" }
      );

      if (data.accounts === 0) {
        toast("No active mailbox to register a watch for.", "info");
        return;
      }

      // The route answers 200 with a per-account outcome even when an account
      // failed, so a 200 is not by itself good news — report what it actually
      // says.
      const bad = data.results.filter((r) => r.outcome !== "renewed");
      if (bad.length === 0) {
        toast(
          data.results.length === 1
            ? `Watch registered for ${data.results[0].email}.`
            : `Watch registered for ${data.results.length} mailboxes.`,
          "success"
        );
      } else {
        toast(`${bad[0].email}: ${bad[0].detail}`, "error");
      }

      // The section above shows watch state read on the server, so it has to
      // be re-read for the result to be visible.
      router.refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Could not register the watch.",
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
      {busy ? "Registering…" : "Register / refresh watch"}
    </button>
  );
}
