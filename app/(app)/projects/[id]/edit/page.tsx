import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";
import ProjectForm from "@/components/forms/ProjectForm";

export const dynamic = "force-dynamic";

export default async function EditProjectPage({
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
        / Edit
      </nav>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Edit project</h1>
      <div className="card">
        <ProjectForm project={project} />
      </div>
    </div>
  );
}
