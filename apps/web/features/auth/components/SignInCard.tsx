"use client";

import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

const oauthErrorMessages: Record<string, string> = {
  no_code: "Sign-in was cancelled. Please try again.",
  token_exchange: "Sign-in failed. Please try again.",
  userinfo: "Could not retrieve your Google profile. Please try again.",
  no_email: "Your Google account didn't share an email. Please try again.",
};

type Mode = "signin" | "signup";

/**
 * Auth card with two modes — sign in and create account — sharing one Google
 * button plus an email/password form. Rendered inside `SignInModal` (marketing
 * popup). Best-practice choices: Google on top, single screen, no confirm-password
 * field, show/hide toggle, inputs preserved on error, mode toggle link.
 */
export default function SignInCard({
  callbackUrl = "/home",
  error,
  devAuthEnabled,
  initialMode = "signin",
}: {
  callbackUrl?: string;
  error?: string;
  devAuthEnabled: boolean;
  initialMode?: Mode;
}) {
  const cb = encodeURIComponent(callbackUrl);

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(
    error ? oauthErrorMessages[error] ?? "Sign-in failed. Please try again." : null
  );

  const isSignup = mode === "signup";

  function switchMode(next: Mode) {
    setMode(next);
    setFormError(null);
    setPassword("");
    setShowPassword(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const endpoint = isSignup ? "/api/auth/signup" : "/api/auth/login";
      const payload = isSignup
        ? { name, email, password }
        : { email, password, callbackUrl };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirectTo?: string;
        error?: string;
      };
      if (!res.ok) {
        setFormError(data.error ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }
      // Full navigation so the freshly-set session cookie is read server-side.
      // Only ever follow the server-validated redirectTo (run through
      // safeRelativePath); fall back to a constant in-app path rather than the
      // raw callbackUrl prop so an attacker-supplied ?callbackUrl can't drive
      // this client-side navigation off-site.
      setDone(true);
      window.location.assign(data.redirectTo ?? "/home");
    } catch {
      setFormError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-10 flex flex-col items-center text-center">
        <Spinner className="h-7 w-7 text-[#78d870]" />
        <p className="mt-5 text-sm font-medium text-gray-700">
          {isSignup ? "Account created — setting things up…" : "Signed in — redirecting…"}
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8 sm:p-10 flex flex-col items-center text-center">
      {/* Logo */}
      <span className="inline-flex items-center gap-2">
        <img src="/images/brand-icon.png" alt="" className="w-7 h-7 rounded-lg" />
        <span className="font-medium text-lg text-[#78d870] tracking-tight">Visvine</span>
      </span>

      {/* Heading */}
      <h1 className="mt-6 text-2xl font-bold text-gray-900 leading-tight">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-2 text-gray-500 text-sm">
        {isSignup
          ? "Join Visvine to explore spaces"
          : "Sign in to continue to Visvine"}
      </p>

      {/* Google — kept most prominent */}
      <div className="mt-7 w-full">
        <a
          href={`/api/auth/signin/google?callbackUrl=${cb}`}
          className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:scale-[0.98] transition-all text-sm font-medium text-gray-700 shadow-sm"
        >
          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </a>
      </div>

      {/* Divider */}
      <div className="my-5 flex w-full items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs font-medium text-gray-400">or</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Email / password */}
      <form onSubmit={onSubmit} className="w-full flex flex-col gap-3 text-left">
        {isSignup && (
          <div>
            <label htmlFor="auth-name" className="sr-only">
              Full name
            </label>
            <input
              id="auth-name"
              type="text"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              disabled={submitting}
              className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#78d870]/40 focus:border-[#78d870] disabled:bg-gray-50"
            />
          </div>
        )}

        <div>
          <label htmlFor="auth-email" className="sr-only">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={submitting}
            className="w-full px-4 py-3 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#78d870]/40 focus:border-[#78d870] disabled:bg-gray-50"
          />
        </div>

        <div>
          <label htmlFor="auth-password" className="sr-only">
            Password
          </label>
          <div className="relative">
            <input
              id="auth-password"
              type={showPassword ? "text" : "password"}
              required
              minLength={isSignup ? MIN_PASSWORD_LENGTH : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              disabled={submitting}
              className="w-full px-4 py-3 pr-16 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#78d870]/40 focus:border-[#78d870] disabled:bg-gray-50"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 flex items-center text-xs font-medium text-gray-500 hover:text-gray-800"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {isSignup && (
            <p className="mt-1.5 text-xs text-gray-400">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        {formError && (
          <p
            role="alert"
            className="text-sm text-red-600 bg-red-50 rounded-lg py-2 px-3"
          >
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-1 w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#78d870] hover:brightness-105 active:scale-[0.98] transition-all text-sm font-semibold text-white shadow-sm disabled:opacity-60"
        >
          {submitting && <Spinner className="h-4 w-4 text-white" />}
          {isSignup ? "Create account" : "Sign in"}
        </button>
      </form>

      {/* Mode toggle */}
      <p className="mt-5 text-sm text-gray-500">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="font-semibold text-[#78d870] hover:underline"
            >
              Sign in
            </button>
          </>
        ) : (
          <>
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className="font-semibold text-[#78d870] hover:underline"
            >
              Create one
            </button>
          </>
        )}
      </p>

      {devAuthEnabled && (
        <a
          href={`/dev/login?callbackUrl=${cb}`}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-300 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-all"
        >
          Dev login (skip auth)
        </a>
      )}
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
