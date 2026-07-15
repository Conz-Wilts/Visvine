'use client';

import React, { useState, useEffect, useMemo, useCallback, ReactNode } from 'react';
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

/** Minimal membership shape needed to hydrate the provider server-side. */
export interface InitialMembership {
  id: string;
  role: string;
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
  // Map of communityId → role for the current user
  const [membershipRoles, setMembershipRoles] = useState<Map<string, string>>(
    () => new Map((initialMemberships ?? []).map(m => [m.id, m.role]))
  );
  // Read localStorage synchronously so graph data can start fetching on first render
  const [currentCommunityId, setCurrentCommunityId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(CURRENT_COMMUNITY_KEY); } catch { return null; }
  });
  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);

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
    const roles = new Map<string, string>();
    for (const c of (data.communities || [])) {
      roles.set(c.id, c.role);
    }
    setMembershipRoles(roles);
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
    setMembershipRoles(prev => new Map(prev).set(communityId, 'member'));
  }, []);

  const leaveCommunity = useCallback(async (communityId: string) => {
    const res = await fetch(`/api/communities/${communityId}/join`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to leave community');
    setMembershipRoles(prev => {
      const next = new Map(prev);
      next.delete(communityId);
      return next;
    });
    if (currentCommunityId === communityId) {
      const remaining = Array.from(membershipRoles.keys()).filter(id => id !== communityId);
      const next = remaining[0] ?? null;
      setCurrentCommunityId(next);
      try { if (next) localStorage.setItem(CURRENT_COMMUNITY_KEY, next); else localStorage.removeItem(CURRENT_COMMUNITY_KEY); } catch {}
    }
  }, [currentCommunityId, membershipRoles]);

  const refreshCommunity = useCallback(async () => {
    await Promise.all([loadAllCommunities(), loadUserCommunities()]);
  }, [loadAllCommunities, loadUserCommunities]);

  const joinedCommunities = useMemo(
    () =>
      communities
        .filter(c => membershipRoles.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [communities, membershipRoles]
  );

  // Use the stored selection when it still resolves; otherwise fall back to the
  // first joined community. This lands a brand-new user in their personal space
  // even when localStorage was never written (e.g. onboarding skipped that step).
  const currentCommunity = useMemo(
    () => communities.find(c => c.id === currentCommunityId) ?? joinedCommunities[0] ?? null,
    [communities, currentCommunityId, joinedCommunities]
  );

  // Derive isAdmin from the resolved current community (super-admins already
  // mapped to 'admin' server-side).
  const isAdmin = currentCommunity ? membershipRoles.get(currentCommunity.id) === 'admin' : false;

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
