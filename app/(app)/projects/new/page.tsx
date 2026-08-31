import ProjectForm from "@/components/forms/ProjectForm";
import { PageHeader } from "@/components/ui/PageHeader";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl">
      {/* The breadcrumb is gone: the header's back arrow says the same thing in
          the place a phone user already looks for it. */}
      <PageHeader
        title="New project"
        subtitle="A job to track costs against"
        backHref="/dashboard"
        backLabel="Back to projects"
      />
      <ProjectForm />
    </div>
  );
}
