"use client";

import { useEffect, useState } from "react";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  nodeId?: string | null;
  isSuperAdmin?: boolean;
}

export interface Session {
  user: SessionUser;
}

/**
 * Client session hook. Pass `initialData` (server-resolved session, or null
 * for "known signed-out") to skip the mount fetch entirely; omit it for the
 * standalone fetch-on-mount behavior.
 */
export function useSession(initialData?: Session | null) {
  const hasInitial = initialData !== undefined;
  const [data, setData] = useState<Session | null>(initialData ?? null);
  const [isPending, setIsPending] = useState(!hasInitial);

  useEffect(() => {
    if (hasInitial) return;
    const controller = new AbortController();
    fetch("/api/auth/session", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setData(json?.session ?? null);
        setIsPending(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        void err;
        setIsPending(false);
      });
    return () => controller.abort();
  }, [hasInitial]);

  return { data, isPending };
}

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" });
}
