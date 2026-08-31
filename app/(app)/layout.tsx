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
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      {/* `pb-nav` reserves the height of the fixed bottom tab bar plus the iOS
          home indicator, so the last row of any list is never trapped under it. */}
      <main className="mx-auto max-w-6xl px-3 pb-nav pt-0 sm:px-4 sm:pb-10 sm:pt-4">
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
