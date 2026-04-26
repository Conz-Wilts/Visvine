"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ClaimActionsProps {
  token: string;
  callbackUrl: string;
}

export function ClaimActions({ token, callbackUrl }: ClaimActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/claim/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, callbackUrl }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.error === "claim_token_invalid") {
          setError(
            "This link has expired or already been used. Please sign in again."
          );
        } else {
          setError("Something went wrong. Please try again.");
        }
        setLoading(false);
        return;
      }

      // Session cookie is set by the server — navigate to destination
      router.push(data.redirectUrl ?? "/directory");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  function handleDeny() {
    // Redirect to sign-in with a message to use a different account
    router.push("/signin?error=claim_denied");
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleClaim}
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Claiming profile…" : "Yes, this is me"}
      </button>

      <button
        onClick={handleDeny}
        disabled={loading}
        className="w-full rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        No, this isn&apos;t me
      </button>
    </div>
  );
}
