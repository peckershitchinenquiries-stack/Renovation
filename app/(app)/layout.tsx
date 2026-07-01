import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav, BottomNav } from "@/components/ui/AppNav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-4 sm:pb-8">{children}</main>
      <BottomNav />
    </div>
  );
}
