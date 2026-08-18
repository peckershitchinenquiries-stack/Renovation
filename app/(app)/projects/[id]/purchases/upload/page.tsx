import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";
import { InvoiceScopeNote } from "@/components/purchases/SourceNote";
import UploadInvoicePanel from "@/components/purchases/UploadInvoicePanel";

export const dynamic = "force-dynamic";

export default async function UploadInvoicePage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <nav className="mb-4 text-sm text-gray-500">
        <Link href={`/projects/${project.id}`} className="hover:underline">
          {project.name}
        </Link>{" "}
        /{" "}
        <Link
          href={`/projects/${project.id}/purchases`}
          className="hover:underline"
        >
          Invoices
        </Link>{" "}
        / Upload
      </nav>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">
        Upload an invoice
      </h1>
      <p className="mb-3 text-sm text-gray-500">
        Drop in a photo or PDF, or add more than one at once. Each is read
        automatically — nothing is saved until you check it on the review
        screen.
      </p>
      <InvoiceScopeNote className="mb-4" />
      <UploadInvoicePanel projectId={project.id} />
    </div>
  );
}
