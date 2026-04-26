"use client";

import { useState, useEffect } from "react";

interface WaitlistModalProps {
  open: boolean;
  onClose: () => void;
}

export default function WaitlistModal({ open, onClose }: WaitlistModalProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setSubmitted(true);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-gray-900 transition-all"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>

        <div className="p-8">
          {submitted ? (
            <div className="text-center py-4">
              <div className="w-14 h-14 bg-brand-green/10 rounded-full flex items-center justify-center mx-auto mb-5">
                <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
                  <circle cx="13" cy="13" r="13" fill="#78d870" opacity="0.2"/>
                  <path d="M7 13L11 17L19 9" stroke="#2f7a3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 font-ginto mb-2">You&apos;re on the list!</h2>
              <p className="text-sm text-gray-500 mb-6">
                We&apos;ll reach out to <span className="font-medium text-gray-700">{email}</span> when your spot opens up.
              </p>
              <button
                onClick={onClose}
                className="h-10 px-6 rounded-full bg-brand-green !text-white text-sm font-semibold hover:opacity-90 transition-all"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-dark-green text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
                  <span className="w-1.5 h-1.5 bg-brand-green rounded-full animate-pulse"/>
                  EARLY ACCESS
                </div>
                <h2 className="text-2xl font-bold text-gray-900 font-ginto mb-1">Join the waitlist</h2>
                <p className="text-sm text-gray-400">Be among the first when we launch.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Full name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Email address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">I manage a...</label>
                  <select
                    required
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all bg-white"
                  >
                    <option value="" disabled>Select one...</option>
                    <option>Alumni network</option>
                    <option>VC / Investment firm</option>
                    <option>Accelerator / Incubator</option>
                    <option>University program</option>
                    <option>Professional community</option>
                    <option>Other</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-brand-green !text-white font-semibold py-3 rounded-xl hover:opacity-90 transition-all text-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                      Joining...
                    </>
                  ) : "Request early access →"}
                </button>
              </form>
              <p className="text-center text-[11px] text-gray-300 mt-3">No spam. Unsubscribe anytime.</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
