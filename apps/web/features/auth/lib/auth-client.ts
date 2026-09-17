"use client";

import { useCallback, useEffect, useState } from "react";

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
 *
 * `refresh` re-reads /api/auth/session. The session route reports the editable
 * half of a person — their name and picture — from their row rather than from
 * the 30-day token, so re-reading it is how a profile edit reaches the shell
 * without a reload.
 */
export function useSession(initialData?: Session | null) {
  const hasInitial = initialData !== undefined;
  const [data, setData] = useState<Session | null>(initialData ?? null);
  const [isPending, setIsPending] = useState(!hasInitial);

  // A server re-render hands down a fresh session; hold it, or the shell keeps
  // rendering whatever the first paint carried for the life of the tab.
  useEffect(() => {
    if (!hasInitial) return;
    setData(initialData ?? null);
  }, [hasInitial, initialData]);

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

  const refresh = useCallback(async () => {
    const res = await fetch("/api/auth/session", { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    setData(json?.session ?? null);
  }, []);

  return { data, isPending, refresh };
}

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" });
}
