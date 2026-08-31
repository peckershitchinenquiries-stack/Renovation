"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/States";

type Mode = "login" | "forgot";

export default function LoginForm() {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await createClient().auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    // Hard navigation, not router.replace/refresh: the browser client just wrote
    // the new session cookie, and a soft client-side nav can reach the server
    // before that cookie is fully attached, so middleware/RLS see no user and
    // the dashboard renders empty until a manual refresh.
    window.location.assign("/dashboard");
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Password reset email sent — check your inbox.", "success");
    setMode("login");
  }

  if (mode === "forgot") {
    return (
      <form onSubmit={handleForgot} className="space-y-4">
        <div>
          <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900">
            Reset your password
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-gray-500">
            We&apos;ll email you a link to choose a new one.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">
          {loading ? (
            <>
              <Spinner /> Sending…
            </>
          ) : (
            "Send reset link"
          )}
        </button>
        <button
          type="button"
          onClick={() => setMode("login")}
          className="btn-ghost btn-sm w-full"
        >
          Back to sign in
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleLogin} className="space-y-4">
      <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900">
        Welcome back
      </h2>

      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="••••••••"
            className="input pr-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {/* Typing a password blind on a phone keyboard is the most common
              cause of a failed sign-in here, so it can be revealed. */}
          <button
            type="button"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="btn-icon absolute right-1 top-1/2 h-10 min-h-0 w-10 min-w-0 -translate-y-1/2 text-gray-400"
          >
            <Icon name={showPassword ? "eyeOff" : "eye"} size={18} />
          </button>
        </div>
      </div>

      <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">
        {loading ? (
          <>
            <Spinner /> Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
      <button
        type="button"
        onClick={() => setMode("forgot")}
        className="btn-ghost btn-sm w-full"
      >
        Forgot password?
      </button>
    </form>
  );
}
