"use client";

import React, { ReactNode, useCallback, useMemo } from "react";
import { createSafeContext } from "@/features/shared/contexts/createSafeContext";
import { useSession, signOut as signOutClient } from "@/features/auth/lib/auth-client";
import { useSpaceRouter } from "@/features/shared/hooks/useSpaceRouter";
import type { Session, SessionUser } from "@/features/auth/lib/auth-client";

interface AuthContextValue {
  user: SessionUser | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  /**
   * Re-read the session. The name and picture the shell draws come from the
   * person's row, not the token, so editing your profile calls this to move
   * the account band with it.
   */
  refreshSession: () => Promise<void>;
}

// `useAuth` is the one client read of the session under the authed shell. The
// provider is hydrated from the server layout, so consumers never fetch
// /api/auth/session themselves.
const [AuthContext, useAuth] = createSafeContext<AuthContextValue>("Auth");
export { useAuth };

interface AuthProviderProps {
  children: ReactNode;
  /**
   * Server-resolved session (or null when known signed-out). When provided,
   * the mount fetch of /api/auth/session is skipped. Omit for the standalone
   * client-only behavior.
   */
  initialSession?: Session | null;
}

export function AuthProvider({ children, initialSession }: AuthProviderProps) {
  const router = useSpaceRouter();
  const { data: session, isPending: isLoading, refresh: refreshSession } = useSession(initialSession);

  const handleSignOut = useCallback(async () => {
    await signOutClient();
    router.push("/");
    router.refresh();
  }, [router]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session: session ?? null,
      isLoading,
      signOut: handleSignOut,
      refreshSession,
    }),
    [session, isLoading, handleSignOut, refreshSession]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}