import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";

export const dynamic = "force-dynamic";

// Two ways into the same document: read it off a photo, or type it in by
// hand. Both end up as one purchase — this screen just decides how you get
// there. Manual entry is exactly the pre-existing /purchases/new screen.
export default async function AddPurchasePage({
  params,
}: {
  params: { id: string };
}) {
  const project = await getProject(params.id);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-2xl">
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
        / Add
      </nav>
      <h1 className="mb-1 text-2xl font-bold text-gray-900">
        Add an invoice
      </h1>
      <p className="mb-4 text-sm text-gray-500">
        Upload a photo or PDF and let it read the details, or type everything
        in yourself.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`/projects/${project.id}/purchases/upload`}
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
          href={`/projects/${project.id}/purchases/new`}
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
