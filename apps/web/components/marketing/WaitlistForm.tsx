"use client";

import { useState, useEffect } from "react";
import { BRAND } from "@/lib/brand";

export default function WaitlistForm() {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          linkedin: linkedin || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "Something went wrong");
        return;
      }
      if (data.alreadyOnList) {
        setStatus("ok");
        setMessage("You're already on the list.");
        setEmail("");
        return;
      }
      setStatus("ok");
      setMessage("You're on the list.");
      setFirstName("");
      setLastName("");
      setEmail("");
      setLinkedin("");
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <>
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setStatus("idle");
            setMessage("");
          }}
          className="px-7 py-3 sm:px-8 sm:py-3.5 rounded-md font-medium text-sm sm:text-base text-white shadow-sm hover:opacity-90 transition"
          style={{ backgroundColor: BRAND }}
        >
          Join waitlist
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 px-4 py-6 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-5 sm:p-8 shadow-xl relative my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {status !== "ok" && (
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute top-3 right-3 hover:opacity-80"
                style={{ color: BRAND }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            )}
            {status === "ok" ? (
              <div className="flex flex-col items-center text-center py-4">
                <div
                  className="flex items-center justify-center w-14 h-14 rounded-full mb-4"
                  style={{ backgroundColor: BRAND }}
                >
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <h2 className="text-2xl font-medium tracking-tight mb-2">
                  You&apos;re on the list
                </h2>
                <p className="text-sm text-neutral-600 mb-6 max-w-xs">
                  Thanks for joining. We&apos;ll be in touch when it&apos;s
                  your turn to onboard into the Visvine community.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-6 py-2.5 rounded-md font-medium text-white text-sm"
                  style={{ backgroundColor: BRAND }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-medium tracking-tight mb-1">
                  Join the waitlist
                </h2>
                <p className="text-sm text-neutral-600 mb-5">
                  Be among the first to try Visvine.
                </p>
                <form
                  onSubmit={onSubmit}
                  className="flex flex-col gap-3 text-left relative"
                >
                  <div className="flex flex-col sm:flex-row gap-3">
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      disabled={status === "loading"}
                      className="flex-1 w-full min-w-0 px-4 py-3 text-base border border-neutral-300 rounded-md focus:outline-none focus:border-black disabled:bg-neutral-50"
                    />
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      disabled={status === "loading"}
                      className="flex-1 w-full min-w-0 px-4 py-3 text-base border border-neutral-300 rounded-md focus:outline-none focus:border-black disabled:bg-neutral-50"
                    />
                  </div>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    disabled={status === "loading"}
                    className="w-full min-w-0 px-4 py-3 text-base border border-neutral-300 rounded-md focus:outline-none focus:border-black disabled:bg-neutral-50"
                  />
                  <input
                    type="url"
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="LinkedIn URL (optional)"
                    disabled={status === "loading"}
                    className="w-full min-w-0 px-4 py-3 text-base border border-neutral-300 rounded-md focus:outline-none focus:border-black disabled:bg-neutral-50"
                  />
                  <button
                    type="submit"
                    disabled={status === "loading"}
                    className="mt-2 px-6 py-3 rounded-md font-medium text-white disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ backgroundColor: BRAND }}
                  >
                    {status === "loading" ? (
                      <>
                        <svg
                          className="animate-spin"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="white"
                            strokeOpacity="0.3"
                            strokeWidth="3"
                          />
                          <path
                            d="M22 12a10 10 0 0 1-10 10"
                            stroke="white"
                            strokeWidth="3"
                            strokeLinecap="round"
                          />
                        </svg>
                        Joining...
                      </>
                    ) : (
                      "Join waitlist"
                    )}
                  </button>
                  {status === "error" && message && (
                    <p className="text-sm text-red-600">{message}</p>
                  )}
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
