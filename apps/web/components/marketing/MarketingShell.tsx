"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import Vines from "@/components/marketing/Vines";
import SignInModal from "@/components/auth/SignInModal";
import { BRAND } from "@/lib/brand";
import { useSession, signOut } from "@/lib/auth-client";

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
  const router = useRouter();
  const isBlog = pathname.startsWith("/blog");
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInCallbackUrl, setSignInCallbackUrl] = useState<string | undefined>(
    undefined,
  );
  const [signInError, setSignInError] = useState<string | undefined>(undefined);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const { data: session, isPending: sessionPending } = useSession();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signin") !== "1") return;
    setSignInOpen(true);
    setSignInCallbackUrl(params.get("callbackUrl") ?? undefined);
    setSignInError(params.get("error") ?? undefined);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) {
        setAvatarOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSignOut() {
    setAvatarOpen(false);
    await signOut();
    router.refresh();
  }

  const user = session?.user;
  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  return (
    <main className="font-ginto relative min-h-[100svh] bg-white text-black flex flex-col overflow-hidden">
      {!isBlog && <Vines />}
      <header className="relative pt-6 sm:pt-10 lg:pt-12 pb-4 flex flex-col items-center gap-3 sm:gap-6 lg:gap-7 z-10 px-4">
        {/* Auth area — top right */}
        <div className="absolute top-6 right-4 sm:right-8 lg:right-12 flex items-center">
          {!sessionPending && !user && (
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Login
            </button>
          )}
          {!sessionPending && user && (
            <div ref={avatarRef} className="relative">
              <button
                onClick={() => setAvatarOpen((v) => !v)}
                className="w-8 h-8 rounded-full overflow-hidden border-2 border-neutral-300 hover:border-neutral-400 transition-colors focus:outline-none"
                aria-label="Account menu"
              >
                {user.image ? (
                  <Image
                    src={user.image}
                    alt={user.name ?? "Profile"}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="w-full h-full flex items-center justify-center bg-neutral-200 text-neutral-700 text-xs font-semibold">
                    {initials}
                  </span>
                )}
              </button>
              {avatarOpen && (
                <div className="absolute right-0 mt-2 w-48 rounded-xl bg-white border border-neutral-200 shadow-lg z-50 py-1 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-neutral-100">
                    <p className="text-sm font-medium text-neutral-900 truncate">{user.name}</p>
                    <p className="text-xs text-neutral-500 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
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
