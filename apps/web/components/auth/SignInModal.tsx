"use client";

import { useEffect } from "react";
import SignInCard from "@/components/auth/SignInCard";

/**
 * Sign-in shown as a lightweight popup layered over the marketing site, so
 * "Login" no longer navigates away to the full `/signin` page. Closes on
 * backdrop click, Escape, or the close button. The full `/signin` route still
 * exists as the fallback for server-side auth redirects.
 */
export default function SignInModal({
  open,
  onClose,
  devAuthEnabled,
  callbackUrl,
  error,
}: {
  open: boolean;
  onClose: () => void;
  devAuthEnabled: boolean;
  callbackUrl?: string;
  error?: string;
}) {
  // Close on Escape and lock background scroll while the popup is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card-rise relative w-full max-w-sm"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500 shadow-md hover:text-gray-900 active:scale-95 transition-all"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path
              d="M5 5l10 10M15 5L5 15"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <SignInCard
          devAuthEnabled={devAuthEnabled}
          callbackUrl={callbackUrl}
          error={error}
        />
      </div>
    </div>
  );
}
