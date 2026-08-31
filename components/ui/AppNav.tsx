"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./Icon";
import { SignOutButton } from "./SignOutButton";

// Destinations only. "Add Project" used to sit here — an action in a list of
// places, and a duplicate of the Dashboard's own "+ Create project" button.
// /projects/new is still a route; it just is not a nav item.
const NAV: { href: string; label: string; icon: IconName }[] = [
  // Dashboard is the only project list — the old /projects list showed the same
  // projects with less information, so it was removed.
  { href: "/dashboard", label: "Home", icon: "home" },
  // Invoices is here so uploading one doesn't require opening a project first —
  // the page itself asks which project it belongs to.
  { href: "/invoices", label: "Invoices", icon: "receipt" },
  // Suppliers and Items were two items holding the same kind of thing: the
  // cross-project register that sits above the project (about.md §4.6). They
  // are one destination with a pivot between them now.
  { href: "/directory", label: "Directory", icon: "store" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function isActive(pathname: string, href: string) {
  // Project detail pages are reached from the dashboard and have no nav item of
  // their own, so Dashboard stays lit while you are inside one. /projects/new
  // no longer has a nav item of its own, so it lights Dashboard too — it is
  // reached from the Dashboard's Create button, which is where it belongs.
  if (href === "/dashboard")
    return pathname === "/dashboard" || /^\/projects(\/|$)/.test(pathname);
  // /suppliers and /items still exist and still render the Directory, so they
  // light it. Without this the nav goes blank on every supplier and item page.
  if (href === "/directory")
    return (
      pathname === "/directory" ||
      /^\/(directory|suppliers|items)(\/|$)/.test(pathname)
    );
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop only. Phones get {@link BottomNav}. */
export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 hidden border-b border-gray-200/80 bg-white/85 backdrop-blur-xl sm:block">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-[0.9375rem] font-bold tracking-[-0.01em] text-gray-900"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
            <Icon name="hammer" size={16} />
          </span>
          RenovaTrack
        </Link>
        <nav className="flex items-center gap-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-brand-50 text-brand-800"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </Link>
            );
          })}
          <span className="mx-2 h-5 w-px bg-gray-200" />
          <SignOutButton className="btn btn-ghost btn-sm" />
        </nav>
      </div>
    </header>
  );
}

/**
 * Mobile navigation: a fixed bottom tab bar.
 *
 * This replaces the hamburger + slide-in drawer. On a phone the four
 * destinations of this app are always one thumb-reach away instead of two taps
 * and an animation behind a menu — which is what makes it read as an app
 * rather than a website. The bar sits above the iOS home indicator via
 * `pb-safe`, and pages reserve room for it with `pb-nav` in the app layout.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200/80 bg-white/90 pb-safe shadow-nav backdrop-blur-xl sm:hidden"
    >
      <ul className="flex items-stretch">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-touch flex-col items-center justify-center gap-1 px-1 pb-2 pt-2.5 transition active:scale-95"
              >
                <span
                  className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${
                    active ? "bg-brand-50 text-brand-700" : "text-gray-400"
                  }`}
                >
                  <Icon name={item.icon} size={20} strokeWidth={active ? 2 : 1.75} />
                </span>
                <span
                  className={`text-[0.6875rem] leading-none tracking-tight ${
                    active ? "font-bold text-brand-800" : "font-medium text-gray-500"
                  }`}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Kept as an alias so any straggling import of the old name still compiles.
 * @deprecated Use {@link BottomNav}.
 */
export const MobileNav = BottomNav;
