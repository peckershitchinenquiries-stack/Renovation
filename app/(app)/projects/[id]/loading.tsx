import {
  CardSkeletonGrid,
  HeaderSkeleton,
  Skeleton,
} from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      {/* `below` stands in for the tab strip inside the header. */}
      <HeaderSkeleton below />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <div className="mt-5 space-y-3">
        <CardSkeletonGrid count={4} />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
