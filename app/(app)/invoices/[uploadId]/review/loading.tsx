import { Skeleton } from "@/components/ui/States";

// Mirrors the review screen's 2fr/3fr split so the layout doesn't jump when
// the extraction and the signed URL land.
export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
        <Skeleton className="h-[45vh] w-full rounded-xl lg:h-[60vh]" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
