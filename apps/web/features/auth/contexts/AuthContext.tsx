"use client";

import React, { ReactNode, useCallback, useMemo } from "react";
import { createSafeContext } from "@/features/shared/contexts/createSafeContext";
import { useSession, signOut as signOutClient } from "@/features/auth/lib/auth-client";
import { useRouter } from "next/navigation";
import type { Session, SessionUser } from "@/features/auth/lib/auth-client";

interface AuthContextValue {
  user: SessionUser | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

// No consumer hook is exported today; the guarded hook can be exposed as
// `useAuth` if/when a consumer needs it.
const [AuthContext] = createSafeContext<AuthContextValue>("Auth");

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
  const router = useRouter();
  const { data: session, isPending: isLoading } = useSession(initialSession);

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
    }),
    [session, isLoading, handleSignOut]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}