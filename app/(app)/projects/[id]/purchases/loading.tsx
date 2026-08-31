import {
  CardSkeletonGrid,
  HeaderSkeleton,
  ListSkeleton,
} from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <div className="space-y-4">
        <CardSkeletonGrid count={4} />
        <ListSkeleton count={5} />
      </div>
    </div>
  );
}
