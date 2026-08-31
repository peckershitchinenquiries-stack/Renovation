import type { Config } from "tailwindcss";

/**
 * Design tokens for the mobile-first redesign.
 *
 * Two deliberate choices here are worth knowing before editing:
 *
 * 1. `gray` is **overridden**, not extended. Hundreds of existing classnames
 *    say `text-gray-500` / `bg-gray-50`. Re-pointing the scale at a warm,
 *    slightly green-tinted neutral re-skins every one of them at once and
 *    keeps the app on a single neutral ramp, instead of leaving Tailwind's
 *    cool default gray fighting the green brand.
 * 2. The brand scale is built *around* the original `#0f5d4a`, which stays as
 *    `brand-700` / `brand.DEFAULT`. The identity does not change; it just
 *    gains the tints and shades a real UI needs.
 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm neutral ramp — replaces Tailwind's cool default gray.
        gray: {
          50: "#f7f8f7",
          100: "#eef0ef",
          200: "#e3e6e4",
          300: "#cbd1cd",
          400: "#9aa29d",
          500: "#6f7873",
          600: "#535c57",
          700: "#3e4641",
          800: "#2a302d",
          900: "#171b19",
          950: "#0d100e",
        },
        brand: {
          DEFAULT: "#0f5d4a",
          dark: "#0d4a3b",
          light: "#2f8a6f",
          50: "#f0f8f5",
          100: "#daeee6",
          200: "#b6ddcd",
          300: "#86c5ae",
          400: "#52a68b",
          500: "#2f8a6f",
          600: "#1d6f59",
          700: "#0f5d4a",
          800: "#0d4a3b",
          900: "#0a3b30",
          950: "#052018",
        },
        // Secondary accent — used for charts, highlights and the "money out"
        // side of comparisons, where a second green would be unreadable.
        clay: {
          50: "#fdf5f0",
          100: "#fae7da",
          200: "#f4cbb2",
          300: "#eba881",
          400: "#e0804f",
          500: "#d2632f",
          600: "#b74d24",
          700: "#983c20",
          800: "#7a3220",
          900: "#642c1d",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Tighter, more deliberate mobile type scale.
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.01em" }],
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        // Soft, low-contrast elevation — premium rather than "floating box".
        card: "0 1px 2px 0 rgb(23 27 25 / 0.04), 0 1px 3px 0 rgb(23 27 25 / 0.04)",
        soft: "0 2px 8px -2px rgb(23 27 25 / 0.08), 0 4px 16px -4px rgb(23 27 25 / 0.06)",
        pop: "0 8px 24px -6px rgb(23 27 25 / 0.16), 0 2px 8px -2px rgb(23 27 25 / 0.08)",
        nav: "0 -1px 0 0 rgb(23 27 25 / 0.06)",
        fab: "0 6px 16px -4px rgb(15 93 74 / 0.45)",
      },
      minHeight: {
        touch: "44px",
      },
      minWidth: {
        touch: "44px",
      },
      spacing: {
        // Bottom-nav clearance, including the iOS home indicator.
        nav: "calc(4.25rem + env(safe-area-inset-bottom))",
        safe: "env(safe-area-inset-bottom)",
      },
      keyframes: {
        "sheet-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(6px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "sheet-up": "sheet-up 0.26s cubic-bezier(0.32, 0.72, 0, 1)",
        "fade-in": "fade-in 0.2s ease-out",
        "pop-in": "pop-in 0.16s ease-out",
        "toast-in": "toast-in 0.22s cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
