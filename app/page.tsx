import LoginForm from "@/components/forms/LoginForm";

// Rendered at request time — the login form needs runtime Supabase env vars.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center text-white">
          <h1 className="text-3xl font-bold">RenovaTrack</h1>
          <p className="mt-1 text-sm text-brand-100">Renovation Project Cost Tracker</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
