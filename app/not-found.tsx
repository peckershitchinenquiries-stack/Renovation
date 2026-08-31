import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
        <Icon name="search" size={26} />
      </span>
      <p className="tnum text-sm font-bold tracking-wider text-gray-400">404</p>
      <h1 className="mt-1.5 text-xl font-bold tracking-[-0.01em] text-gray-900">
        Page not found
      </h1>
      <p className="mt-1.5 max-w-xs text-sm leading-relaxed text-gray-500">
        That link doesn&apos;t point anywhere in RenovaTrack.
      </p>
      <Link href="/dashboard" className="btn-primary mt-6">
        Back to home
      </Link>
    </main>
  );
}
