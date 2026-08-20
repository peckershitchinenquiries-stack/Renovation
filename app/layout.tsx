import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/Toast";
import { NumberInputScrollGuard } from "@/components/ui/NumberInputScrollGuard";

export const metadata: Metadata = {
  title: "RenovaTrack — Renovation Project Cost Tracker",
  description: "Track renovation project costs, labour, materials and VAT.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f5d4a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-GB">
      <body>
        <NumberInputScrollGuard />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
