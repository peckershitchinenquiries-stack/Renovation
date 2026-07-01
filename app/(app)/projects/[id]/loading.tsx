import { Skeleton, CardSkeletonGrid } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="card">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <CardSkeletonGrid count={4} />
      <div className="card">
        <Skeleton className="h-60 w-full" />
      </div>
    </div>
  );
}
