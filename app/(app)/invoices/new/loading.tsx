import { Skeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
