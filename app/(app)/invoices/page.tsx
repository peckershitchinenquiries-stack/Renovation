import Link from "next/link";
import DrainHealth from "@/components/invoices/DrainHealth";
import TriageSection from "@/components/invoices/TriageSection";
import EmailInvoices from "@/components/invoices/EmailInvoices";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Icon, type IconName } from "@/components/ui/Icon";

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
      <PageHeader
        title="Invoices"
        subtitle="Add one, or check what arrived by email"
        flush
      />

      {/* Adding comes first now. The email sections used to sit above the
          heading, so the page opened on a status report for a background job
          rather than on the thing the reader came to do. */}
      <section className="mb-6">
        <SectionHeader
          title="Add an invoice"
          hint="You pick the project when you save it."
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AddChoice
            href="/invoices/upload"
            icon="camera"
            tone="brand"
            title="Upload a photo or PDF"
            description="The supplier, lines and total are read automatically. You check it before it saves."
          />
          <AddChoice
            href="/invoices/new"
            icon="edit"
            tone="info"
            title="Type it in"
            description="Enter the supplier, the lines on the invoice and any payments yourself."
          />
        </div>
      </section>

      <DrainHealth />
      <TriageSection />
      {/* Everything else that came out of the mailbox. Unlike the two above it
          this one always renders something, because "did my email arrive?" has
          no useful silent answer. */}
      <EmailInvoices />
    </div>
  );
}

const TONES = {
  brand: "bg-brand-50 text-brand-700",
  info: "bg-blue-50 text-blue-600",
} as const;

function AddChoice({
  href,
  icon,
  tone,
  title,
  description,
}: {
  href: string;
  icon: IconName;
  tone: keyof typeof TONES;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="card flex items-start gap-3.5 transition active:scale-[0.99] hover:border-brand-200 hover:shadow-soft"
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${TONES[tone]}`}
      >
        <Icon name={icon} size={21} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.9375rem] font-bold text-gray-900">
          {title}
        </span>
        <span className="mt-1 block text-[0.8125rem] leading-relaxed text-gray-500">
          {description}
        </span>
      </span>
      <Icon name="chevronRight" size={18} className="mt-1 shrink-0 text-gray-300" />
    </Link>
  );
}
