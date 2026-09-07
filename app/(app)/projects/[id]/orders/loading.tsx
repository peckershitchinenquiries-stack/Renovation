import { HeaderSkeleton, ListSkeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton />
      <ListSkeleton count={5} />
    </div>
  );
}
