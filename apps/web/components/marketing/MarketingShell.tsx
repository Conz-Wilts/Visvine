"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
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

type SignInMode = "signin" | "signup";

/**
 * Lets any client component rendered inside the marketing shell (e.g. the home
 * page CTAs) open the sign-in popup in a chosen mode. Provided by MarketingShell.
 */
const SignInModalContext = createContext<(mode?: SignInMode) => void>(() => {});

export function useSignInModal() {
  return useContext(SignInModalContext);
}

export default function MarketingShell({
  children,
  devAuthEnabled = false,
}: {
  children: React.ReactNode;
  devAuthEnabled?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isBlogPost = pathname.startsWith("/blog/");
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInMode, setSignInMode] = useState<SignInMode>("signin");
  const [signInCallbackUrl, setSignInCallbackUrl] = useState<string | undefined>(
    undefined,
  );
  const [signInError, setSignInError] = useState<string | undefined>(undefined);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const { data: session, isPending: sessionPending } = useSession();

  const openSignIn = useCallback((mode: SignInMode = "signin") => {
    setSignInMode(mode);
    setSignInError(undefined);
    setSignInOpen(true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wantSignin = params.get("signin") === "1";
    const wantSignup = params.get("signup") === "1";
    if (!wantSignin && !wantSignup) return;
    setSignInMode(wantSignup || params.get("mode") === "signup" ? "signup" : "signin");
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
      {!isBlogPost && <Vines />}
      {/* White navbar — sits above the vines so the buttons keep their contrast */}
      <header className="relative z-30 w-full border-b border-neutral-200 bg-white">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-4 px-4 sm:px-6 lg:px-8 h-16">
          {/* Left: brand */}
          <Link
            href="/"
            className="text-xl sm:text-2xl font-semibold tracking-tight"
            style={{ color: BRAND }}
          >
            Visvine
          </Link>

          {/* Center: nav */}
          <nav className="hidden md:flex items-center justify-center gap-6 lg:gap-10 text-sm lg:text-base text-neutral-600">
            {LINKS.map((l) => {
              const active =
                l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  style={active ? { color: BRAND } : undefined}
                  className={active ? "" : "hover:text-black"}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          {/* Right: auth */}
          <div className="flex items-center justify-end gap-2">
            {!sessionPending && !user && (
              <>
                <button
                  type="button"
                  onClick={() => openSignIn("signin")}
                  className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => openSignIn("signup")}
                  className="rounded-md px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
                  style={{ backgroundColor: BRAND }}
                >
                  Create account
                </button>
              </>
            )}
            {!sessionPending && user && (
              <div ref={avatarRef} className="relative">
                <button
                  onClick={() => setAvatarOpen((v) => !v)}
                  className="w-8 h-8 rounded-lg overflow-hidden border-2 border-brand-green transition-colors focus:outline-none"
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
        </div>
      </header>
      <SignInModalContext.Provider value={openSignIn}>
        {children}
      </SignInModalContext.Provider>
      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        devAuthEnabled={devAuthEnabled}
        callbackUrl={signInCallbackUrl}
        error={signInError}
        initialMode={signInMode}
      />
    </main>
  );
}
