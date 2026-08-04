'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, ReactNode } from 'react';
import { Community } from '@/lib/types';
import { createSafeContext } from './createSafeContext';

interface CommunityContextValue {
  communities: Community[];
  currentCommunity: Community | null;
  joinedCommunities: Community[];
  setCurrentCommunity: (communityId: string) => void;
  joinCommunity: (communityId: string, alias?: string) => Promise<void>;
  leaveCommunity: (communityId: string) => Promise<void>;
  refreshCommunity: () => Promise<void>;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
}

const [CommunityContext, useCommunity] = createSafeContext<CommunityContextValue>('Community');
export { useCommunity };

const CURRENT_COMMUNITY_KEY = 'nb_current_community';

// The stored selection is read in a layout effect, not during render: the
// server has no localStorage, so a synchronous read would make the first client
// render disagree with the SSR'd HTML. Layout effects flush before children's
// passive effects and before paint, so consumers still see the restored
// community before they fetch, with no flash.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Minimal membership shape needed to hydrate the provider server-side. */
export interface InitialMembership {
  id: string;
  isAdmin: boolean;
}

interface CommunityProviderProps {
  children: ReactNode;
  /**
   * Server-fetched hydration data (same shapes the /api/data/communities and
   * /api/user/communities routes return). When BOTH are provided the mount
   * fetch is skipped entirely; revalidation paths (refreshCommunity, etc.)
   * still fetch as before. Omit both for the standalone client-only behavior.
   */
  initialCommunities?: Community[];
  initialMemberships?: InitialMembership[];
}

export function CommunityProvider({ children, initialCommunities, initialMemberships }: CommunityProviderProps) {
  const hasInitialData = initialCommunities !== undefined && initialMemberships !== undefined;
  const [communities, setCommunities] = useState<Community[]>(initialCommunities ?? []);
  // communityId → whether the user manages it (holds an alias marked `admin`
  // there). Membership is the key's presence; standing is the value.
  const [memberships, setMemberships] = useState<Map<string, boolean>>(
    () => new Map((initialMemberships ?? []).map(m => [m.id, m.isAdmin]))
  );
  const [currentCommunityId, setCurrentCommunityId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);

  // Restore the stored selection once, right after hydration (see the note above).
  useIsomorphicLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENT_COMMUNITY_KEY);
      if (stored) setCurrentCommunityId(stored);
    } catch {}
  }, []);

  const loadAllCommunities = useCallback(async () => {
    const res = await fetch('/api/data/communities');
    if (!res.ok) throw new Error('Failed to load communities');
    const data = await res.json();
    setCommunities(data.communities || []);
  }, []);

  const loadUserCommunities = useCallback(async () => {
    const res = await fetch('/api/user/communities');
    if (!res.ok) return; // unauthenticated — leave empty
    const data = await res.json();
    const next = new Map<string, boolean>();
    for (const c of (data.communities || [])) {
      next.set(c.id, c.isAdmin === true);
    }
    setMemberships(next);
  }, []);

  useEffect(() => {
    // Server already hydrated both lists — no mount fetch needed. Revalidation
    // paths (refreshCommunity, joinCommunity, ...) still fetch on demand.
    if (hasInitialData) return;
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([loadAllCommunities(), loadUserCommunities()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load communities');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [hasInitialData, loadAllCommunities, loadUserCommunities]);

  const setCurrentCommunity = useCallback((communityId: string) => {
    setCurrentCommunityId(communityId);
    try { localStorage.setItem(CURRENT_COMMUNITY_KEY, communityId); } catch {}
  }, []);

  const joinCommunity = useCallback(async (communityId: string, alias?: string) => {
    const res = await fetch(`/api/communities/${communityId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || data.error || 'Failed to join community');
    }
    setMemberships(prev => new Map(prev).set(communityId, false));
  }, []);

  const leaveCommunity = useCallback(async (communityId: string) => {
    const res = await fetch(`/api/communities/${communityId}/join`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to leave community');
    setMemberships(prev => {
      const next = new Map(prev);
      next.delete(communityId);
      return next;
    });
    if (currentCommunityId === communityId) {
      const remaining = Array.from(memberships.keys()).filter(id => id !== communityId);
      const next = remaining[0] ?? null;
      setCurrentCommunityId(next);
      try { if (next) localStorage.setItem(CURRENT_COMMUNITY_KEY, next); else localStorage.removeItem(CURRENT_COMMUNITY_KEY); } catch {}
    }
  }, [currentCommunityId, memberships]);

  const refreshCommunity = useCallback(async () => {
    await Promise.all([loadAllCommunities(), loadUserCommunities()]);
  }, [loadAllCommunities, loadUserCommunities]);

  const joinedCommunities = useMemo(
    () =>
      communities
        .filter(c => memberships.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [communities, memberships]
  );

  // Use the stored selection when it still resolves; otherwise fall back to the
  // first joined community. This lands a brand-new user in their personal space
  // even when localStorage was never written (e.g. onboarding skipped that step).
  const currentCommunity = useMemo(
    () => communities.find(c => c.id === currentCommunityId) ?? joinedCommunities[0] ?? null,
    [communities, currentCommunityId, joinedCommunities]
  );

  // Derive isAdmin from the resolved current community. Managing a community
  // means holding one of its aliases marked `admin` — resolved server-side, so
  // super-admins are already folded in here.
  const isAdmin = currentCommunity ? memberships.get(currentCommunity.id) === true : false;

  const value = useMemo<CommunityContextValue>(
    () => ({
      communities,
      currentCommunity,
      joinedCommunities,
      setCurrentCommunity,
      joinCommunity,
      leaveCommunity,
      refreshCommunity,
      loading,
      error,
      isAdmin,
    }),
    [
      communities,
      currentCommunity,
      joinedCommunities,
      setCurrentCommunity,
      joinCommunity,
      leaveCommunity,
      refreshCommunity,
      loading,
      error,
      isAdmin,
    ]
  );

  return (
    <CommunityContext.Provider value={value}>
      {children}
    </CommunityContext.Provider>
  );
}
