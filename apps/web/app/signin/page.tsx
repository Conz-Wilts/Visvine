import { isDevAuthEnabled } from "@/lib/dev-auth";

const errorMessages: Record<string, string> = {
  no_code: "Sign-in was cancelled. Please try again.",
  token_exchange: "Sign-in failed. Please try again.",
  userinfo: "Could not retrieve your Google profile. Please try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl = "/directory", error } = await searchParams;
  const cb = encodeURIComponent(callbackUrl);
  const devAuthEnabled = isDevAuthEnabled();

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f0] p-4">
      {/* Centered card */}
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-10 flex flex-col items-center text-center">
        {/* Logo */}
        <span className="inline-flex items-center gap-2">
          <span className="w-7 h-7 rounded-lg bg-[#78d870] flex items-center justify-center">
            <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
              <circle cx="10" cy="10" r="3" fill="white" />
              <circle cx="3" cy="5" r="2" fill="white" opacity="0.7" />
              <circle cx="17" cy="5" r="2" fill="white" opacity="0.7" />
              <circle cx="3" cy="15" r="2" fill="white" opacity="0.7" />
              <circle cx="17" cy="15" r="2" fill="white" opacity="0.7" />
              <line x1="10" y1="10" x2="3" y2="5" stroke="white" strokeWidth="1.2" opacity="0.5" />
              <line x1="10" y1="10" x2="17" y2="5" stroke="white" strokeWidth="1.2" opacity="0.5" />
              <line x1="10" y1="10" x2="3" y2="15" stroke="white" strokeWidth="1.2" opacity="0.5" />
              <line x1="10" y1="10" x2="17" y2="15" stroke="white" strokeWidth="1.2" opacity="0.5" />
            </svg>
          </span>
          <span className="font-bold text-lg text-gray-900 tracking-tight">Visvine</span>
        </span>

        {/* Heading */}
        <h1 className="mt-8 text-2xl font-bold text-gray-900 leading-tight">
          Welcome back
        </h1>
        <p className="mt-2 text-gray-500 text-sm">
          Sign in to explore your network graph
        </p>

        {/* Auth */}
        <div className="mt-8 w-full flex flex-col gap-3">
          <a
            href={`/api/auth/signin/google?callbackUrl=${cb}&real=1`}
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

          {devAuthEnabled && (
            <a
              href={`/dev/login?callbackUrl=${cb}`}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-[#78d870] hover:brightness-105 active:scale-[0.98] transition-all text-sm font-semibold text-white shadow-sm"
            >
              Dev login
            </a>
          )}

          {error && (
            <p className="text-center text-sm text-red-500 bg-red-50 rounded-lg py-2 px-3">
              {errorMessages[error] ?? "Sign-in failed. Please try again."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
