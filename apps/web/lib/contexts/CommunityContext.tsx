'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Community } from '@/lib/types';

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

const CommunityContext = createContext<CommunityContextValue | undefined>(undefined);

const CURRENT_COMMUNITY_KEY = 'nb_current_community';

export function CommunityProvider({ children }: { children: ReactNode }) {
  const [communities, setCommunities] = useState<Community[]>([]);
  // Map of communityId → role for the current user
  const [membershipRoles, setMembershipRoles] = useState<Map<string, string>>(new Map());
  // Read localStorage synchronously so graph data can start fetching on first render
  const [currentCommunityId, setCurrentCommunityId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try { return localStorage.getItem(CURRENT_COMMUNITY_KEY); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAllCommunities = async () => {
    const res = await fetch('/api/data/communities');
    if (!res.ok) throw new Error('Failed to load communities');
    const data = await res.json();
    setCommunities(data.communities || []);
  };

  const loadUserCommunities = async () => {
    const res = await fetch('/api/user/communities');
    if (!res.ok) return; // unauthenticated — leave empty
    const data = await res.json();
    const roles = new Map<string, string>();
    for (const c of (data.communities || [])) {
      roles.set(c.id, c.role);
    }
    setMembershipRoles(roles);
  };

  useEffect(() => {
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
  }, []);

  const setCurrentCommunity = (communityId: string) => {
    setCurrentCommunityId(communityId);
    try { localStorage.setItem(CURRENT_COMMUNITY_KEY, communityId); } catch {}
  };

  const joinCommunity = async (communityId: string, alias?: string) => {
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
  };

  const leaveCommunity = async (communityId: string) => {
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
  };

  const refreshCommunity = async () => {
    await Promise.all([loadAllCommunities(), loadUserCommunities()]);
  };

  const joinedCommunities = communities
    .filter(c => membershipRoles.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Use the stored selection when it still resolves; otherwise fall back to the
  // first joined community. This lands a brand-new user in their personal space
  // even when localStorage was never written (e.g. onboarding skipped that step).
  const currentCommunity =
    communities.find(c => c.id === currentCommunityId) ?? joinedCommunities[0] ?? null;

  // Derive isAdmin from the resolved current community (super-admins already
  // mapped to 'admin' server-side).
  const isAdmin = currentCommunity ? membershipRoles.get(currentCommunity.id) === 'admin' : false;

  return (
    <CommunityContext.Provider
      value={{
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
      }}
    >
      {children}
    </CommunityContext.Provider>
  );
}

export function useCommunity() {
  const context = useContext(CommunityContext);
  if (!context) {
    throw new Error('useCommunity must be used within CommunityProvider');
  }
  return context;
}
