import LoginForm from "@/components/forms/LoginForm";
import { Icon } from "@/components/ui/Icon";

// Rendered at request time — the login form needs runtime Supabase env vars.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen flex-col justify-end overflow-hidden bg-brand-900 px-5 pb-8 pt-16 sm:justify-center sm:pb-16">
      {/* Two soft light sources over a deep brand ground. Cheaper than an
          image, and it keeps the sign-in screen from being a flat green box. */}
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
          <p className="mt-1.5 text-sm text-white/60">
            Every cost on 46 Glenferrie Road, in one place.
          </p>
        </div>

        <div className="rounded-3xl bg-white p-5 shadow-pop sm:p-6">
          <LoginForm />
        </div>

        <p className="mt-5 text-center text-xs text-white/45">
          Accounts are created by the project owner.
        </p>
      </div>
    </main>
  );
}
