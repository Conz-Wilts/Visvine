import type { Metadata, Viewport } from "next";
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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme boot script ((auth)/layout.tsx) sets the accent vars on <html> before hydration.
    <html lang="en" suppressHydrationWarning>
      <body className="text-text-secondary antialiased">
        {children}
      </body>
    </html>
  );
}
