import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { NumberInputScrollGuard } from "@/components/ui/NumberInputScrollGuard";

// Self-hosted by next/font, so there is no external stylesheet request and no
// flash of unstyled text. `--font-sans` is what tailwind.config.ts points at.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RenovaTrack — Renovation Project Cost Tracker",
  description: "Track renovation project costs, labour, materials and VAT.",
  // Phones are the only real client, so the app should install and behave like
  // one: no browser chrome when added to the home screen.
  appleWebApp: {
    capable: true,
    title: "RenovaTrack",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Content must extend under the status bar / home indicator for the safe-area
  // insets used by the bottom navigation to mean anything.
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body>
        <NumberInputScrollGuard />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
