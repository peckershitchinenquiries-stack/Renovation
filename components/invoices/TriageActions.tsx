"use client";

// The two buttons on a triage row.
//
// One decision, expressed two ways:
//
//   Trust this sender & extract — records the sender's domain in
//   supplier_domains, so every future invoice from them is read automatically
//   and never appears on this list again.
//
//   Extract once — reads this one and remembers nothing. Right for a one-off,
//   or for a colleague forwarding somebody else's invoice.
//
// Both land on the review screen, which is where every invoice is checked by a
// human before it becomes a purchase — trusting a *sender* never means
// trusting an *invoice*.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { useToast } from "@/components/ui/Toast";

interface TriageResponse {
  upload_id: string;
  status: "extracted" | "failed" | "pending";
  trusted: string | null;
  message?: string;
}

export default function TriageActions({ uploadId }: { uploadId: string }) {
  const [busy, setBusy] = useState<null | "trust" | "once">(null);
  const toast = useToast();
  const router = useRouter();

  async function run(trustSender: boolean) {
    setBusy(trustSender ? "trust" : "once");
    try {
      const data = await apiFetch<TriageResponse>(
        `/api/invoices/${uploadId}/triage`,
        { method: "POST", body: JSON.stringify({ trustSender }) }
      );

      // Rate-limited rather than read: the route returns 200 with 'pending'
      // because nothing is wrong with the document. Sending the user to an
      // empty review screen would be the lie here.
      if (data.status === "pending") {
        toast(data.message ?? "Not read yet — it will be retried.", "info");
        router.refresh();
        return;
      }

      toast(
        data.trusted
          ? `Reading it. Future invoices from ${data.trusted} will skip triage.`
          : "Reading it.",
        "success"
      );
      router.push(`/invoices/${uploadId}/review`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not read that invoice.", "error");
      // The row's status has moved even on failure, so re-read the list.
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => run(true)}
        disabled={busy !== null}
        className="btn-primary min-h-touch text-xs disabled:opacity-50"
      >
        {busy === "trust" ? "Reading…" : "Trust this sender & extract"}
      </button>
      <button
        type="button"
        onClick={() => run(false)}
        disabled={busy !== null}
        className="btn-secondary min-h-touch text-xs disabled:opacity-50"
      >
        {busy === "once" ? "Reading…" : "Extract once"}
      </button>
    </div>
  );
}
