"use client";

const oauthErrorMessages: Record<string, string> = {
  no_code: "Sign-in was cancelled. Please try again.",
  token_exchange: "Sign-in failed. Please try again.",
  userinfo: "Could not retrieve your Google profile. Please try again.",
  no_email: "Your Google account didn't share an email. Please try again.",
};

type Mode = "signin" | "signup";

/**
 * Auth card. Google is the only way in: an account IS a Google account, so
 * there is one button and nothing to fill in. Rendered inside `SignInModal`
 * (marketing popup).
 *
 * `initialMode` only changes the words. The marketing CTAs open this in
 * "signup" mode, and continuing with Google creates the account if there isn't
 * one — the same call either way, so there is no second screen and no way to
 * pick the wrong one.
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
  const isSignup = initialMode === "signup";

  const formError = error
    ? oauthErrorMessages[error] ?? "Sign-in failed. Please try again."
    : null;

  return (
    <div className="w-full max-w-sm bg-surface-1 rounded-xl shadow-float p-8 sm:p-10 flex flex-col items-center text-center">
      {/* Logo */}
      <span className="inline-flex items-center gap-2">
        <img src="/images/brand-icon.png" alt="" className="w-7 h-7 rounded-lg" />
        <span className="font-brand font-medium text-lg text-brand-green tracking-tight">Visvine</span>
      </span>

      {/* Heading */}
      <h1 className="mt-6 text-2xl font-bold text-text-primary leading-tight">
        {isSignup ? "Create your account" : "Sign in"}
      </h1>

      <div className="mt-7 w-full">
        <a
          href={`/api/auth/signin/google?callbackUrl=${cb}`}
          className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-lg border border-border-subtle bg-surface-1 hover:bg-surface-2 active:scale-[0.98] transition-all text-sm font-medium text-text-secondary"
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

      {formError && (
        <p
          role="alert"
          className="mt-4 w-full border-l-2 border-red-500 pl-3 py-1 text-left text-sm text-red-600"
        >
          {formError}
        </p>
      )}

      {devAuthEnabled && (
        <a
          href={`/dev/login?callbackUrl=${cb}`}
          className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium text-text-muted hover:bg-surface-2 hover:text-text-secondary transition-all"
        >
          Dev login (skip auth)
        </a>
      )}
    </div>
  );
}
