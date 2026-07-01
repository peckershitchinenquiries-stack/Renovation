"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects/new", label: "Add Project", icon: "＋" },
  { href: "/projects", label: "Projects", icon: "🏠" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function isActive(pathname: string, href: string) {
  if (href === "/projects")
    return pathname === "/projects" || /^\/projects\/[^/]+$/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 hidden border-b border-gray-200 bg-white sm:block">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="text-lg font-bold text-brand">
          RenovaTrack
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(pathname, item.href)
                  ? "bg-brand-50 text-brand"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <span className="mx-2 h-5 w-px bg-gray-200" />
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white sm:hidden">
      <div className="grid grid-cols-4">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-touch flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
              isActive(pathname, item.href) ? "text-brand" : "text-gray-500"
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
