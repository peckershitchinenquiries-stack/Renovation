import {
  CardSkeletonGrid,
  HeaderSkeleton,
  ListSkeleton,
} from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="space-y-5">
        <CardSkeletonGrid count={4} />
        <ListSkeleton count={6} />
      </div>
    </div>
  );
}
