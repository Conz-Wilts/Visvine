"use client";

import { useCallback, useEffect, useState } from "react";
import SignInModal from "@/features/auth/components/SignInModal";
import { BRAND } from "@/lib/brand";
import { useSession } from "@/features/auth/lib/auth-client";

type SignInMode = "signin" | "signup";

/**
 * The marketing site's frame, and the whole of it: the wordmark in the middle
 * of the page with Create account and Login beneath it. The desktop shell
 * lands here too — signing in is the only thing to do on either one.
 */
export default function MarketingShell({
  children,
  devAuthEnabled = false,
}: {
  children: React.ReactNode;
  devAuthEnabled?: boolean;
}) {
  const [signInOpen, setSignInOpen] = useState(false);
  const [signInMode, setSignInMode] = useState<SignInMode>("signin");
  const [signInCallbackUrl, setSignInCallbackUrl] = useState<string | undefined>(
    undefined,
  );
  const [signInError, setSignInError] = useState<string | undefined>(undefined);
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

  const user = session?.user;

  return (
    <main className="font-brand relative min-h-[100svh] bg-white text-black flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8">
        <h1
          className="text-5xl sm:text-6xl font-semibold tracking-tight"
          style={{ color: BRAND }}
        >
          Visvine
        </h1>
        {!sessionPending && !user && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openSignIn("signup")}
              className="rounded-md px-6 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90 active:scale-[0.99] transition"
              style={{ backgroundColor: BRAND }}
            >
              Create account
            </button>
            <button
              type="button"
              onClick={() => openSignIn("signin")}
              className="rounded-md border border-neutral-300 px-6 py-2.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 active:scale-[0.99] transition"
            >
              Login
            </button>
          </div>
        )}
        {children}
      </div>
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
