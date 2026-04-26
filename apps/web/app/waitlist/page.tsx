"use client";

import { useState } from "react";
import Link from "next/link";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    // Simulate submission — wire up to a real endpoint or Airtable/Notion later
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Floating pill navbar — matches home page */}
      <div className="fixed top-4 left-0 right-0 z-50 flex justify-center px-6">
        <nav className="w-full max-w-4xl flex items-center gap-4 px-4 py-2.5 bg-white/90 backdrop-blur-md rounded-full shadow-lg shadow-gray-200/60 border border-gray-100">
          <Link href="/" className="text-2xl font-bold tracking-tight font-ginto shrink-0 pl-1" style={{ color: '#78d870' }}>
            Visvine
          </Link>
          <div className="flex-1 flex items-center justify-center gap-1">
            <Link href="/#features" className="text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all px-4 py-1.5 rounded-full">Features</Link>
            <Link href="/#how-it-works" className="text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all px-4 py-1.5 rounded-full">How it works</Link>
            <Link href="/#pricing" className="text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all px-4 py-1.5 rounded-full">Pricing</Link>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/signin" className="h-9 flex items-center px-4 rounded-full text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-all">
              Log in
            </Link>
            <Link href="/waitlist" className="h-9 flex items-center px-5 rounded-full bg-brand-green !text-white text-sm font-semibold hover:opacity-90 transition-all shadow-sm">
              Join Waitlist
            </Link>
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 pt-28 pb-16">
        <div className="w-full max-w-xl">
          {submitted ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-brand-green/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <circle cx="14" cy="14" r="14" fill="#78d870" opacity="0.2"/>
                  <path d="M8 14L12 18L20 10" stroke="#2f7a3e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 font-[family-name:var(--font-ginto)] mb-3">You're on the list!</h1>
              <p className="text-gray-500 mb-8">We'll reach out to <span className="font-medium text-gray-700">{email}</span> when your spot opens up. Expect to hear from us soon.</p>
              <Link href="/" className="text-sm text-brand-dark-green font-medium hover:underline">← Back to home</Link>
            </div>
          ) : (
            <>
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 bg-brand-green/10 text-brand-dark-green text-xs font-medium px-3 py-1.5 rounded-full mb-4">
                  <span className="w-1.5 h-1.5 bg-brand-green rounded-full animate-pulse"></span>
                  EARLY ACCESS
                </div>
                <h1 className="text-4xl font-bold text-gray-900 font-[family-name:var(--font-ginto)] mb-3">
                  Join the waitlist
                </h1>
                <p className="text-gray-500">Be among the first to use Visvine. We're rolling out access to early adopters every week.</p>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-lg shadow-gray-100/50 p-8">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Full name</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Email address</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.com"
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">I manage a...</label>
                    <select
                      required
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-all bg-white"
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
                    className="w-full bg-brand-green text-white font-semibold py-3.5 rounded-xl hover:bg-brand-dark-green transition-colors text-sm disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        Joining...
                      </>
                    ) : "Request early access →"}
                  </button>
                </form>
                <p className="text-center text-xs text-gray-400 mt-4">No spam. Unsubscribe anytime.</p>
              </div>

              {/* Social proof */}
              <div className="mt-8 flex items-center justify-center gap-6">
                {["50+ communities", "10k+ nodes mapped", "Launching Q2 2026"].map((stat) => (
                  <div key={stat} className="text-center">
                    <div className="text-xs text-gray-400">{stat}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
