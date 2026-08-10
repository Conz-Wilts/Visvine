'use client';

/**
 * ProfileContext
 *
 * A thin in-memory cache keyed by personId. Any component that fetches or
 * mutates a person profile writes into this store; any component that
 * displays profile data reads from it first before falling back to the
 * underlying node data.
 *
 * This means profile edits made in ProfilePageContent are immediately
 * visible in FullProfileOverlay without a page reload or context-cache bust.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createSafeContext } from './createSafeContext';
import type { FullProfile } from '@/lib/types/profile';

interface ProfileCacheEntry {
  profile: FullProfile;
  updatedAt: number;
}

interface ProfileContextValue {
  /** Get the cached profile for a personId, or null if not cached. */
  getCached: (personId: string) => FullProfile | null;
  /** Write (or overwrite) the cache entry for a personId. */
  setCache: (personId: string, profile: FullProfile) => void;
  /** Patch only changed fields into an existing cache entry. */
  patchCache: (personId: string, patch: Partial<FullProfile>) => void;
  /**
   * A version counter that increments on every write — components can
   * subscribe to this to re-render when any profile changes.
   */
  version: number;
}

const [ProfileContext, useProfileCache] = createSafeContext<ProfileContextValue>('Profile', 'useProfileCache');
export { useProfileCache };

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const cacheRef = useRef<Map<string, ProfileCacheEntry>>(new Map());
  const [version, setVersion] = useState(0);

  const bump = useCallback(() => setVersion(v => v + 1), []);

  const getCached = useCallback((personId: string): FullProfile | null => {
    return cacheRef.current.get(personId)?.profile ?? null;
  }, []);

  const setCache = useCallback((personId: string, profile: FullProfile) => {
    cacheRef.current.set(personId, { profile, updatedAt: Date.now() });
    bump();
  }, [bump]);

  const patchCache = useCallback((personId: string, patch: Partial<FullProfile>) => {
    const existing = cacheRef.current.get(personId);
    if (existing) {
      cacheRef.current.set(personId, {
        profile: { ...existing.profile, ...patch },
        updatedAt: Date.now(),
      });
    } else {
      // Can't patch what isn't there — store partial so callers can still read it
      cacheRef.current.set(personId, {
        profile: patch as FullProfile,
        updatedAt: Date.now(),
      });
    }
    bump();
  }, [bump]);

  const value = useMemo<ProfileContextValue>(
    () => ({ getCached, setCache, patchCache, version }),
    [getCached, setCache, patchCache, version]
  );

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  );
}
