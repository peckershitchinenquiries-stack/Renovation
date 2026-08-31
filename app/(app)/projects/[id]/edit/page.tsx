import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";
import ProjectForm from "@/components/forms/ProjectForm";
import { PageHeader } from "@/components/ui/PageHeader";

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
      <PageHeader
        title="Edit project"
        subtitle={project.name}
        backHref={`/projects/${project.id}`}
        backLabel="Back to project"
      />
      <ProjectForm project={project} />
    </div>
  );
}
