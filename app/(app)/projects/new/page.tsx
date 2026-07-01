import Link from "next/link";
import ProjectForm from "@/components/forms/ProjectForm";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <nav className="mb-4 text-sm text-gray-500">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>{" "}
        / New project
      </nav>
      <h1 className="mb-4 text-2xl font-bold text-gray-900">Create project</h1>
      <div className="card">
        <ProjectForm />
      </div>
    </div>
  );
}
