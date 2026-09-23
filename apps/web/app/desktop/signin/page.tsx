import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createHandoff, isWellFormedChallenge } from "@/lib/auth/desktopHandoff";

/**
 * The browser's half of a desktop sign-in (lib/auth/desktopHandoff.ts). The
 * shell opens this page in the system browser — the one place a passkey, a
 * saved password and a hardware key all work — and the press below is what
 * hands it a session.
 *
 * Its own gate, so the signed-out hop keeps the challenge on the URL: the
 * proxy's redirect carries the path alone.
 */

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-subtle flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface rounded-xl shadow-float p-8 sm:p-10 flex flex-col items-center text-center">
        <span className="inline-flex items-center gap-2">
          <img src="/images/brand-icon.png" alt="" className="w-7 h-7 rounded-lg" />
          <span className="font-brand font-medium text-lg text-accent tracking-tight">Visvine</span>
        </span>
        {children}
      </div>
    </div>
  );
}

export default async function DesktopSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const challenge = (await searchParams).challenge ?? null;
  if (!isWellFormedChallenge(challenge)) {
    return (
      <Shell>
        <p className="mt-6 text-sm text-fg-muted">Start again from the Visvine app.</p>
      </Shell>
    );
  }

  const here = `/desktop/signin?challenge=${encodeURIComponent(challenge)}`;
  const session = await getSession();
  if (!session) redirect(`/signin?callbackUrl=${encodeURIComponent(here)}`);

  const handoff = await createHandoff({ userId: session.userId, challenge });

  return (
    <Shell>
      <h1 className="mt-6 text-2xl font-bold text-fg leading-tight">Open Visvine</h1>
      <p className="mt-2 text-sm text-fg-muted">{session.email}</p>

      <a
        href={`visvine-desktop://auth?handoff=${encodeURIComponent(handoff)}`}
        className="mt-7 w-full inline-flex items-center justify-center px-4 py-3.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 active:translate-y-[1px] transition-all"
      >
        Open the app
      </a>

      {/* The session the browser already holds is the one the app is offered.
          Anyone signing a second account in goes back through Google, which is
          asked to show the account chooser rather than reuse this one. */}
      <a
        href={`/api/auth/signin/google?callbackUrl=${encodeURIComponent(here)}&prompt=select_account`}
        className="mt-4 text-sm text-fg-muted hover:text-fg underline underline-offset-4"
      >
        Use a different account
      </a>
    </Shell>
  );
}
