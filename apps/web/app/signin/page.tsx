"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/directory";
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    no_code: "Sign-in was cancelled. Please try again.",
    token_exchange: "Sign-in failed. Please try again.",
    userinfo: "Could not retrieve your Google profile. Please try again.",
  };

  function handleGoogleSignIn() {
    window.location.href = `/api/auth/signin/google?callbackUrl=${encodeURIComponent(callbackUrl)}`;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f0] p-4">
      {/* Outer card */}
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl overflow-hidden flex min-h-[560px]">

        {/* ── Left panel ── */}
        <div className="flex-1 flex flex-col justify-between p-10 lg:p-12">
          {/* Logo */}
          <div>
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
          </div>

          {/* Heading */}
          <div className="mt-10">
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-gray-500 text-sm">
              Sign in to explore your network graph
            </p>
          </div>

          {/* Auth */}
          <div className="mt-8 flex flex-col gap-3">
            <button
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 active:scale-[0.98] transition-all text-sm font-medium text-gray-700 shadow-sm"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            {error && (
              <p className="text-center text-sm text-red-500 bg-red-50 rounded-lg py-2 px-3">
                {errorMessages[error] ?? "Sign-in failed. Please try again."}
              </p>
            )}
          </div>

          {/* Footer */}
          <p className="mt-auto pt-10 text-xs text-gray-400 text-center">
            By continuing you agree to our{" "}
            <a href="#" className="underline hover:text-gray-600">Terms</a>
            {" & "}
            <a href="#" className="underline hover:text-gray-600">Privacy Policy</a>
          </p>
        </div>

        {/* ── Right panel ── */}
        <div className="hidden md:flex flex-1 relative bg-[#eaf9ec] overflow-hidden rounded-r-3xl">
          {/* Soft gradient wash */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#eaf9ec] via-[#d4f5d4] to-[#c0edbe]" />

          {/* Network SVG — muted green on light bg */}
          <svg
            className="absolute inset-0 w-full h-full opacity-20"
            viewBox="0 0 500 560"
            preserveAspectRatio="xMidYMid slice"
          >
            <line x1="250" y1="280" x2="120" y2="160" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="380" y2="160" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="100" y2="360" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="400" y2="380" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="250" y2="100" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="180" y2="440" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="250" y1="280" x2="360" y2="460" stroke="#2f7a3e" strokeWidth="1.5" />
            <line x1="120" y1="160" x2="60" y2="80" stroke="#2f7a3e" strokeWidth="1" />
            <line x1="120" y1="160" x2="200" y2="60" stroke="#2f7a3e" strokeWidth="1" />
            <line x1="380" y1="160" x2="440" y2="80" stroke="#2f7a3e" strokeWidth="1" />
            <line x1="380" y1="160" x2="460" y2="220" stroke="#2f7a3e" strokeWidth="1" />
            <line x1="100" y1="360" x2="40" y2="420" stroke="#2f7a3e" strokeWidth="1" />
            <line x1="400" y1="380" x2="460" y2="460" stroke="#2f7a3e" strokeWidth="1" />
            <circle cx="250" cy="280" r="8" fill="#78d870" />
            <circle cx="120" cy="160" r="5" fill="#78d870" />
            <circle cx="380" cy="160" r="5" fill="#78d870" />
            <circle cx="100" cy="360" r="5" fill="#78d870" />
            <circle cx="400" cy="380" r="5" fill="#78d870" />
            <circle cx="250" cy="100" r="5" fill="#78d870" />
            <circle cx="180" cy="440" r="5" fill="#78d870" />
            <circle cx="360" cy="460" r="5" fill="#78d870" />
            <circle cx="60" cy="80" r="3" fill="#2f7a3e" />
            <circle cx="200" cy="60" r="3" fill="#2f7a3e" />
            <circle cx="440" cy="80" r="3" fill="#2f7a3e" />
            <circle cx="460" cy="220" r="3" fill="#2f7a3e" />
            <circle cx="40" cy="420" r="3" fill="#2f7a3e" />
            <circle cx="460" cy="460" r="3" fill="#2f7a3e" />
          </svg>

          {/* Network stats card */}
          <div className="absolute top-8 left-6 bg-white/80 backdrop-blur-sm border border-white shadow-sm rounded-2xl p-4 w-44">
            <p className="text-gray-400 text-xs mb-2">Network Stats</p>
            <div className="flex items-end gap-1">
              <span className="text-gray-900 text-2xl font-bold">248</span>
              <span className="text-[#2f7a3e] text-xs mb-1">nodes</span>
            </div>
            <div className="mt-2 flex gap-1 items-end">
              {[4, 7, 5, 8, 6, 9, 7].map((h, i) => (
                <div key={i} className="flex-1 bg-[#78d870] rounded-sm" style={{ height: `${h * 3}px` }} />
              ))}
            </div>
          </div>

          {/* Recent connection card */}
          <div className="absolute bottom-16 right-6 bg-white/80 backdrop-blur-sm border border-white shadow-sm rounded-2xl p-4 w-52">
            <p className="text-gray-400 text-xs mb-3">Recent Connection</p>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[#eaf9ec] flex items-center justify-center text-[#2f7a3e] text-sm font-bold border border-[#78d870]/30">A</div>
              <div>
                <p className="text-gray-900 text-sm font-medium">Alex Chen</p>
                <p className="text-gray-400 text-xs">Startup Founder</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#78d870]" />
              <span className="text-[#2f7a3e] text-xs">Connected 2m ago</span>
            </div>
          </div>

          {/* Communities card */}
          <div className="absolute bottom-40 left-6 bg-white/80 backdrop-blur-sm border border-white shadow-sm rounded-2xl p-4 w-44">
            <p className="text-gray-400 text-xs mb-2">Communities</p>
            <div className="flex -space-x-2 mt-1">
              {["#78d870", "#4ade80", "#22c55e", "#2f7a3e"].map((c, i) => (
                <div key={i} className="w-7 h-7 rounded-full border-2 border-white" style={{ backgroundColor: c }} />
              ))}
              <div className="w-7 h-7 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-gray-500 text-[10px] font-medium">+9</div>
            </div>
          </div>

          {/* Center brand text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8">
            <h2 className="text-gray-900 text-2xl font-bold leading-snug">
              Visualize your<br />
              network
            </h2>
            <p className="mt-3 text-gray-500 text-sm max-w-48">
              Map relationships, discover connections, grow together.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#f0f4f0]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#78d870]" />
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
