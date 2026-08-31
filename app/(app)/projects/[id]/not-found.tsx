import Link from "next/link";
import { EmptyState } from "@/components/ui/States";

export default function ProjectNotFound() {
  return (
    <div className="pt-8">
      <EmptyState
        icon="home"
        title="Project not found"
        description="This project doesn't exist, or it has been deleted."
        action={
          <Link href="/dashboard" className="btn-primary">
            Back to home
          </Link>
        }
      />
    </div>
  );
}
