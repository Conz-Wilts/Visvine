"use client";

import { useEffect } from "react";
import Modal from "@/components/ui/Modal";
import SignInCard from "@/features/auth/components/SignInCard";

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
  initialMode = "signin",
}: {
  open: boolean;
  onClose: () => void;
  devAuthEnabled: boolean;
  callbackUrl?: string;
  error?: string;
  initialMode?: "signin" | "signup";
}) {
  // Lock background scroll while the popup is open (Escape is handled by Modal).
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Sign in"
      maxWidth="max-w-sm"
      overlayClassName="items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      overlayStyle={{ animation: "fadeIn 0.2s ease-out" }}
      panelClassName="card-rise relative"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute -top-3 -right-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-surface text-fg-muted shadow-float hover:text-fg active:scale-95 transition-all"
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
        key={initialMode}
        initialMode={initialMode}
        devAuthEnabled={devAuthEnabled}
        callbackUrl={callbackUrl}
        error={error}
      />
    </Modal>
  );
}
