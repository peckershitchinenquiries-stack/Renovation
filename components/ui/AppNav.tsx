"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { SignOutButton } from "./SignOutButton";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/projects", label: "Projects", icon: "🏠" },
  { href: "/projects/new", label: "Add Project", icon: "＋" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

function isActive(pathname: string, href: string) {
  // /projects covers the list and any project detail page, but not /projects/new,
  // which is its own nav item.
  if (href === "/projects")
    return (
      pathname === "/projects" ||
      (/^\/projects\/[^/]+/.test(pathname) &&
        !pathname.startsWith("/projects/new"))
    );
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

// Mobile navigation: a compact top bar with a hamburger, opening a slide-in
// drawer from the left edge (replaces the old bottom tab bar).
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Any navigation closes the drawer.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: Escape closes it, and the page behind must not scroll.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-gray-200 bg-white px-2 py-2 sm:hidden">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-2xl leading-none text-gray-700 active:bg-gray-100"
        >
          ☰
        </button>
        <Link href="/dashboard" className="text-lg font-bold text-brand">
          RenovaTrack
        </Link>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav
            aria-label="Main"
            className="drawer-left absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <span className="text-lg font-bold text-brand">RenovaTrack</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="flex min-h-touch min-w-touch items-center justify-center rounded-lg text-2xl leading-none text-gray-400 active:text-gray-700"
              >
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-touch items-center gap-3 rounded-lg px-3 py-3 text-base font-medium ${
                    isActive(pathname, item.href)
                      ? "bg-brand-50 text-brand"
                      : "text-gray-700 active:bg-gray-100"
                  }`}
                >
                  <span className="w-6 text-center text-lg leading-none">
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              ))}
            </div>

            <div className="border-t border-gray-200 p-2">
              <SignOutButton className="flex min-h-touch w-full items-center gap-3 rounded-lg px-3 py-3 text-base font-medium text-gray-700 active:bg-gray-100" />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
