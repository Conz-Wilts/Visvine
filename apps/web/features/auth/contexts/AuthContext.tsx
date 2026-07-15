"use client";

import React, { ReactNode } from "react";
import { createSafeContext } from "@/lib/contexts/createSafeContext";
import { useSession, signOut as signOutClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import type { Session, SessionUser } from "@/lib/auth-client";

interface AuthContextValue {
  user: SessionUser | null;
  session: Session | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
}

// No consumer hook is exported today; the guarded hook can be exposed as
// `useAuth` if/when a consumer needs it.
const [AuthContext] = createSafeContext<AuthContextValue>("Auth");

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { data: session, isPending: isLoading } = useSession();

  const handleSignOut = async () => {
    await signOutClient();
    router.push("/");
    router.refresh();
  };

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session: session ?? null,
        isLoading,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}