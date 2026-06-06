"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Vines from "@/components/marketing/Vines";
import SignInModal from "@/components/auth/SignInModal";
import { BRAND } from "@/lib/brand";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/manifesto", label: "Manifesto" },
  { href: "/contact", label: "Contact" },
];

export default function MarketingShell({
  children,
  devAuthEnabled = false,
}: {
  children: React.ReactNode;
  devAuthEnabled?: boolean;
}) {
  const pathname = usePathname();
  const isBlog = pathname.startsWith("/blog");
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInCallbackUrl, setSignInCallbackUrl] = useState<string | undefined>(
    undefined,
  );
  const [signInError, setSignInError] = useState<string | undefined>(undefined);

  // Open the sign-in popup when we arrive with `?signin=1` — that's how every
  // redirect into sign-in (middleware, protected pages, OAuth errors, old
  // `/signin` links) now lands the user: on the home screen with the popup up.
  // Read from `window.location` (not `useSearchParams`) to avoid forcing the
  // static marketing pages into a Suspense boundary. Strip the params after so
  // a refresh doesn't re-open it and the address bar stays clean.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") !== "1") return;
    setSignInOpen(true);
    setSignInCallbackUrl(params.get("callbackUrl") ?? undefined);
    setSignInError(params.get("error") ?? undefined);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <main className="font-ginto relative min-h-[100svh] bg-white text-black flex flex-col overflow-hidden">
      {!isBlog && <Vines />}
      <header className="relative pt-6 sm:pt-10 lg:pt-12 pb-4 flex flex-col items-center gap-3 sm:gap-6 lg:gap-7 z-10 px-4">
        <button
          type="button"
          onClick={() => setSignInOpen(true)}
          className="absolute top-6 right-4 sm:right-8 lg:right-12 rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Login
        </button>
        <Link
          href="/"
          className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight"
          style={{ color: BRAND }}
        >
          Visvine
        </Link>
        <nav className="grid grid-cols-3 gap-6 sm:gap-8 lg:gap-10 text-sm sm:text-base lg:text-lg text-neutral-600">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                style={active ? { color: BRAND } : undefined}
                className={`text-center ${active ? "" : "hover:text-black"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
      {children}
      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        devAuthEnabled={devAuthEnabled}
        callbackUrl={signInCallbackUrl}
        error={signInError}
      />
    </main>
  );
}
