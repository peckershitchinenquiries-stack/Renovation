import { Skeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <Skeleton className="mb-4 h-8 w-40" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="mt-3 h-4 w-full" />
            <Skeleton className="mt-2 h-2 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
