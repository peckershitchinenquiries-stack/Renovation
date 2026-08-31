import { HeaderSkeleton, Skeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <Skeleton className="h-36 w-full rounded-3xl" />
      <Skeleton className="mb-2.5 mt-5 h-4 w-24" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-3 h-7 w-28" />
            <Skeleton className="mt-3.5 h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
