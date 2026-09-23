import type { Metadata, Viewport } from "next";
import { color } from "@visvine/tokens";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visvine",
  description: "Welcome to Visvine",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: color.surface.backdrop,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme boot script ((auth)/layout.tsx) sets the accent attribute on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body className="text-fg-secondary antialiased">
        {children}
      </body>
    </html>
  );
}
