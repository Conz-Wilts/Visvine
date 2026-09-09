"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import PersonSilhouette from "@/components/ui/PersonSilhouette";
import { useRouter } from "next/navigation";
import Vines from "@/features/marketing/components/Vines";
import SignInModal from "@/features/auth/components/SignInModal";
import { BRAND } from "@/lib/brand";
import { useSession, signOut } from "@/features/auth/lib/auth-client";

type SignInMode = "signin" | "signup";

/**
 * The marketing site's frame: the wordmark and the auth buttons sit at the
 * top of the page over the vines, with no bar beneath them. In the desktop
 * shell (`desktop`) the website falls away: just the vines, the wordmark and
 * a Login button, since the only thing to do there is sign in.
 *
 * The vines are taller than the page and are clipped by a layer of their OWN
 * rather than by an overflow on <main>. A clip on <main> makes it a scroll
 * port, and a scroll port can be scrolled by anything — arriving from the app
 * after Sign out, the router scrolls the new page's section into view and
 * shunts the whole frame up by the header's height, taking the wordmark and
 * the auth buttons off the top of the screen with no scrollbar to bring them
 * back. Clipping the layer that actually overflows leaves nothing to scroll.
 */
export default function MarketingShell({
  children,
  devAuthEnabled = false,
  desktop = false,
}: {
  children: React.ReactNode;
  devAuthEnabled?: boolean;
  desktop?: boolean;
}) {
  const router = useRouter();
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

  const signInModal = (
    <SignInModal
      open={signInOpen}
      onClose={() => setSignInOpen(false)}
      devAuthEnabled={devAuthEnabled}
      callbackUrl={signInCallbackUrl}
      error={signInError}
      initialMode={signInMode}
    />
  );

  if (desktop) {
    return (
      <main className="font-brand relative min-h-[100svh] bg-white text-black flex flex-col items-center justify-center">
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <Vines />
        </div>
        <div className="relative z-30 flex flex-col items-center gap-8">
          <h1
            className="text-5xl sm:text-6xl font-semibold tracking-tight"
            style={{ color: BRAND }}
          >
            Visvine
          </h1>
          {!sessionPending && !user && (
            <button
              type="button"
              onClick={() => openSignIn("signin")}
              className="rounded-md px-10 py-3.5 text-base font-medium text-white shadow-sm hover:opacity-90 active:scale-[0.99] transition"
              style={{ backgroundColor: BRAND }}
            >
              Login
            </button>
          )}
        </div>
        {signInModal}
      </main>
    );
  }

  return (
    <main className="font-brand relative min-h-[100svh] bg-white text-black flex flex-col">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <Vines />
      </div>
      <header className="relative z-30 w-full">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 h-16">
          {/* Left: brand */}
          <Link
            href="/"
            className="text-xl sm:text-2xl font-semibold tracking-tight"
            style={{ color: BRAND }}
          >
            Visvine
          </Link>


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
                    <PersonSilhouette />
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
      {children}
      {signInModal}
    </main>
  );
}
