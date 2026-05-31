'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface FullProfileContextValue {
  /**
   * Open the full-screen profile for a node. This navigates to the node's own
   * page (`/directory/<nodeId>`) rather than opening an overlay, so full-screen
   * profiles have their own shareable URL and don't sit on top of /directory.
   */
  openProfile: (nodeId: string) => void;
}

const FullProfileContext = createContext<FullProfileContextValue | null>(null);

export function FullProfileProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const openProfile = useCallback(
    (nodeId: string) => router.push(`/directory/${encodeURIComponent(nodeId)}`),
    [router]
  );

  return (
    <FullProfileContext.Provider value={{ openProfile }}>
      {children}
    </FullProfileContext.Provider>
  );
}

export function useFullProfile() {
  const ctx = useContext(FullProfileContext);
  if (!ctx) throw new Error('useFullProfile must be used inside FullProfileProvider');
  return ctx;
}
