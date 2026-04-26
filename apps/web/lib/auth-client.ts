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

export function useSession() {
  const [data, setData] = useState<Session | null>(null);
  const [isPending, setIsPending] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        setData(json?.session ?? null);
        setIsPending(false);
      })
      .catch(() => setIsPending(false));
  }, []);

  return { data, isPending };
}

export async function signOut() {
  await fetch("/api/auth/signout", { method: "POST" });
}
