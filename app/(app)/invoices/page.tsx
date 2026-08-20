import Link from "next/link";

export const dynamic = "force-dynamic";

// Two ways into the same document: read it off a photo, or type it in by
// hand. Both end up as one purchase — this screen just decides how you get
// there.
//
// This used to live at /projects/[id]/purchases/add, which meant you had to
// know which job an invoice belonged to before you could even photograph it.
// The project is now asked for on the form itself, at the moment the invoice
// is saved, so this sits in the nav bar instead.
export default function AddInvoicePage() {
  return (
    <div className="mx-auto max-w-2xl">
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
