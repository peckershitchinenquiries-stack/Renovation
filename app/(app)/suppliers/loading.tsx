import { HeaderSkeleton, ListSkeleton } from "@/components/ui/States";

export default function Loading() {
  return (
    <div>
      <HeaderSkeleton below />
      <ListSkeleton count={8} />
    </div>
  );
}
