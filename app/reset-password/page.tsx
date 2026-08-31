"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/States";

export default function ResetPasswordPage() {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Password updated.", "success");
    // Hard navigation for the same reason as LoginForm: a freshly-written
    // session cookie needs a real HTTP request to be reliably visible to
    // middleware/RLS, not a soft client-side transition.
    window.location.assign("/dashboard");
  }

  return (
    // Same ground as the sign-in screen, so arriving here from the reset email
    // does not look like a different application.
    <main className="relative flex min-h-screen flex-col justify-end overflow-hidden bg-brand-900 px-5 pb-8 pt-16 sm:justify-center sm:pb-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_60%_at_50%_0%,rgba(47,138,111,0.55),transparent_70%),radial-gradient(90%_50%_at_10%_100%,rgba(15,93,74,0.7),transparent_60%)]"
      />

      <div className="relative mx-auto w-full max-w-sm">
        <div className="mb-8 sm:text-center">
          <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-inset ring-white/20 backdrop-blur sm:mx-auto">
            <Icon name="hammer" size={26} />
          </span>
          <h1 className="text-[1.75rem] font-bold tracking-[-0.02em] text-white">
            RenovaTrack
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-3xl bg-white p-5 shadow-pop sm:p-6"
        >
          <div>
            <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900">
              Set a new password
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              At least 6 characters.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="password">
              New password
            </label>
            <div className="relative">
              <input
                id="password"
                type={show ? "text" : "password"}
                required
                minLength={6}
                autoComplete="new-password"
                placeholder="••••••••"
                className="input pr-12"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="btn-icon absolute right-1 top-1/2 h-10 min-h-0 w-10 min-w-0 -translate-y-1/2 text-gray-400"
              >
                <Icon name={show ? "eyeOff" : "eye"} size={18} />
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary btn-lg w-full"
          >
            {loading ? (
              <>
                <Spinner /> Saving…
              </>
            ) : (
              "Update password"
            )}
          </button>
        </form>
      </div>
    </main>
  );
}
