import Link from "next/link";

export default function ProjectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-5xl font-bold text-brand">404</p>
      <h1 className="mt-2 text-xl font-semibold text-gray-900">
        Project not found
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        This project doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        Back to dashboard
      </Link>
    </div>
  );
}
