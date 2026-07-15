'use client';

import React, { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createSafeContext } from './createSafeContext';

interface FullProfileContextValue {
  /**
   * Open the full-screen profile for a node. This navigates to the node's own
   * page (`/directory/<nodeId>`) rather than opening an overlay, so full-screen
   * profiles have their own shareable URL and don't sit on top of /directory.
   */
  openProfile: (nodeId: string) => void;
}

const [FullProfileContext, useFullProfile] = createSafeContext<FullProfileContextValue>('FullProfile');
export { useFullProfile };

export function FullProfileProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const openProfile = useCallback(
    (nodeId: string) => router.push(`/directory/${encodeURIComponent(nodeId)}`),
    [router]
  );

  const value = useMemo<FullProfileContextValue>(() => ({ openProfile }), [openProfile]);

  return (
    <FullProfileContext.Provider value={value}>
      {children}
    </FullProfileContext.Provider>
  );
}
