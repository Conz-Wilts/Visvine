'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';

interface FullProfileContextValue {
  /** Currently open profile node ID, or null */
  openNodeId: string | null;
  /** Open the full-screen profile overlay for a node */
  openProfile: (nodeId: string) => void;
  /** Close the overlay */
  closeProfile: () => void;
}

const FullProfileContext = createContext<FullProfileContextValue | null>(null);

export function FullProfileProvider({ children }: { children: React.ReactNode }) {
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);

  const openProfile = useCallback((nodeId: string) => setOpenNodeId(nodeId), []);
  const closeProfile = useCallback(() => setOpenNodeId(null), []);

  return (
    <FullProfileContext.Provider value={{ openNodeId, openProfile, closeProfile }}>
      {children}
    </FullProfileContext.Provider>
  );
}

export function useFullProfile() {
  const ctx = useContext(FullProfileContext);
  if (!ctx) throw new Error('useFullProfile must be used inside FullProfileProvider');
  return ctx;
}
