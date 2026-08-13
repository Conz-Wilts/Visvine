"use client";

import { BRAND } from "@/lib/brand";
import { useSignInModal } from "@/features/marketing/components/MarketingShell";

/**
 * Primary calls-to-action on the marketing home: "Join our space" (opens the
 * sign-in popup in signup mode) is primary, with a "Sign in" link
 * beneath it.
 */
export default function HomeCtas() {
  const openSignIn = useSignInModal();

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        type="button"
        onClick={() => openSignIn("signup")}
        className="px-8 py-3.5 sm:px-10 sm:py-4 rounded-md font-medium text-base sm:text-lg text-white shadow-sm hover:opacity-90 active:scale-[0.99] transition"
        style={{ backgroundColor: BRAND }}
      >
        Join our space
      </button>

      <p className="text-sm sm:text-base text-neutral-600">
        Already have an account?{" "}
        <button
          type="button"
          onClick={() => openSignIn("signin")}
          className="font-medium underline-offset-4 hover:underline"
          style={{ color: BRAND }}
        >
          Sign in
        </button>
      </p>
    </div>
  );
}
