import Link from "next/link";
import DrainHealth from "@/components/invoices/DrainHealth";
import TriageSection from "@/components/invoices/TriageSection";
import EmailInvoices from "@/components/invoices/EmailInvoices";

export const dynamic = "force-dynamic";

// Two ways into the same document: read it off a photo, or type it in by
// hand. Both end up as one purchase — this screen just decides how you get
// there.
//
// This used to live at /projects/[id]/purchases/add, which meant you had to
// know which job an invoice belonged to before you could even photograph it.
// The project is now asked for on the form itself, at the moment the invoice
// is saved, so this sits in the nav bar instead.
// Now also the home of everything that arrives by email: the drain-health
// line, the triage queue, and the list of invoices already pulled out of the
// mailbox. The first two render nothing when there is nothing waiting. The
// third always renders, because it is the answer to "did my email get here?"
// and a blank screen is not one.
export default function AddInvoicePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <DrainHealth />
      <TriageSection />
      {/* Everything else that came out of the mailbox. Unlike the two above it
          this one always renders something, because "did my email arrive?" has
          no useful silent answer. */}
      <EmailInvoices />

      <h1 className="mb-1 text-2xl font-bold text-gray-900">Add an invoice</h1>
      <p className="mb-4 text-sm text-gray-500">
        Upload a photo or PDF and let it read the details, or type everything
        in yourself. Either way you pick the project when you save it.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/invoices/upload"
          className="card flex min-h-touch flex-col items-start gap-2 p-5 text-left transition hover:border-brand hover:shadow-md"
        >
          <span className="text-3xl" aria-hidden>
            📤
          </span>
          <span className="text-base font-semibold text-gray-900">
            Upload invoice
          </span>
          <span className="text-sm text-gray-500">
            Photo or PDF — the supplier, lines and total are read
            automatically. You check it before it saves.
          </span>
        </Link>

        <Link
          href="/invoices/new"
          className="card flex min-h-touch flex-col items-start gap-2 p-5 text-left transition hover:border-brand hover:shadow-md"
        >
          <span className="text-3xl" aria-hidden>
            📝
          </span>
          <span className="text-base font-semibold text-gray-900">
            Enter manually
          </span>
          <span className="text-sm text-gray-500">
            Type in the supplier, the lines on the invoice and any payments
            yourself.
          </span>
        </Link>
      </div>
    </div>
  );
}
