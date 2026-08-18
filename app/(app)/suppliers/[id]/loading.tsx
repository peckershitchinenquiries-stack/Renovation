import { Skeleton, CardSkeletonGrid } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="space-y-4">
      <div>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-2 h-8 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <CardSkeletonGrid count={4} />
      <div className="card space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
