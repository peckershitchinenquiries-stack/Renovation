"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={signOut}
      className={className || "text-sm text-gray-500 hover:text-gray-800"}
    >
      Sign out
    </button>
  );
}
