'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, ReactNode } from 'react';
import { Space } from '@/lib/types';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { createSafeContext } from './createSafeContext';
import type { LockedSubspace } from '@/lib/spaces/subspaceAccess';

interface SpaceContextValue {
  spaces: Space[];
  currentSpace: Space | null;
  joinedSpaces: Space[];
  /** Private sub-spaces of a space you are in, which you are not in: the
   *  locked rows the switcher and the context tree draw. */
  lockedSubspaces: LockedSubspace[];
  setCurrentSpace: (spaceId: string) => void;
  joinSpace: (spaceId: string, alias?: string) => Promise<void>;
  leaveSpace: (spaceId: string) => Promise<void>;
  refreshSpace: () => Promise<void>;
  /** Ask to join a locked sub-space. Writes a pending membership its admins
   *  answer on Members → Wants to join; nothing about the space opens yet. */
  requestSubspaceAccess: (spaceId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  isAdmin: boolean;
  /** Whether the user manages a given space — the standing behind every
   *  admin-only offer made about a space other than the current one. */
  manages: (spaceId: string) => boolean;
}

const [SpaceContext, useSpace] = createSafeContext<SpaceContextValue>('Space');
export { useSpace };

// Storage key kept at its pre-rename spelling on purpose: changing it would
// drop every signed-in browser back to no space selected.
const CURRENT_SPACE_KEY = 'nb_current_community';

// The stored selection is read in a layout effect, not during render: the
// server has no localStorage, so a synchronous read would make the first client
// render disagree with the SSR'd HTML. Layout effects flush before children's
// passive effects and before paint, so consumers still see the restored
// space before they fetch, with no flash.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Minimal membership shape needed to hydrate the provider server-side. */
export interface InitialMembership {
  id: string;
  isAdmin: boolean;
}

interface SpaceProviderProps {
  children: ReactNode;
  /**
   * Server-fetched hydration data (same shapes the /api/data/communities and
   * /api/user/communities routes return). When BOTH are provided the mount
   * fetch is skipped entirely; revalidation paths (refreshSpace, etc.)
   * still fetch as before. Omit both for the standalone client-only behavior.
   */
  initialSpaces?: Space[];
  initialMemberships?: InitialMembership[];
  initialLockedSubspaces?: LockedSubspace[];
}

export function SpaceProvider({
  children,
  initialSpaces,
  initialMemberships,
  initialLockedSubspaces,
}: SpaceProviderProps) {
  const hasInitialData = initialSpaces !== undefined && initialMemberships !== undefined;
  const [spaces, setSpaces] = useState<Space[]>(initialSpaces ?? []);
  const [lockedSubspaces, setLockedSubspaces] = useState<LockedSubspace[]>(initialLockedSubspaces ?? []);
  // spaceId → whether the user manages it (holds an alias marked `admin`
  // there). Membership is the key's presence; standing is the value.
  const [memberships, setMemberships] = useState<Map<string, boolean>>(
    () => new Map((initialMemberships ?? []).map(m => [m.id, m.isAdmin]))
  );
  const [currentSpaceId, setCurrentSpaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState<string | null>(null);

  // Restore the stored selection once, right after hydration (see the note above).
  useIsomorphicLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(CURRENT_SPACE_KEY);
      if (stored) setCurrentSpaceId(stored);
    } catch {}
  }, []);

  const loadAllSpaces = useCallback(async () => {
    // fetchJson sends the whole page to /signin on a 401, so a signed-out
    // session can't keep rendering a stale space list.
    const data = await fetchJson<{ spaces?: Space[]; lockedSubspaces?: LockedSubspace[] }>(
      '/api/data/communities',
    );
    setSpaces(data.spaces || []);
    setLockedSubspaces(data.lockedSubspaces || []);
  }, []);

  const loadUserSpaces = useCallback(async () => {
    let data: { spaces?: Array<{ id: string; isAdmin?: boolean }> };
    try {
      data = await fetchJson('/api/user/communities');
    } catch {
      return; // failed — leave memberships as they are (401 already kicked to /signin)
    }
    const next = new Map<string, boolean>();
    for (const c of (data.spaces || [])) {
      next.set(c.id, c.isAdmin === true);
    }
    setMemberships(next);
  }, []);

  useEffect(() => {
    // Server already hydrated both lists — no mount fetch needed. Revalidation
    // paths (refreshSpace, joinSpace, ...) still fetch on demand.
    if (hasInitialData) return;
    const init = async () => {
      setLoading(true);
      try {
        await Promise.all([loadAllSpaces(), loadUserSpaces()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load spaces');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [hasInitialData, loadAllSpaces, loadUserSpaces]);

  const setCurrentSpace = useCallback((spaceId: string) => {
    setCurrentSpaceId(spaceId);
    try { localStorage.setItem(CURRENT_SPACE_KEY, spaceId); } catch {}
  }, []);

  const joinSpace = useCallback(async (spaceId: string, alias?: string) => {
    await fetchJsonBody(`/api/communities/${spaceId}/join`, 'POST', { alias });
    setMemberships(prev => new Map(prev).set(spaceId, false));
  }, []);

  // Asking is its own act: the membership lands `pending`, so the row stays
  // locked and only changes its label. Marking it here rather than refetching
  // keeps the button from offering itself a second time while an admin decides.
  const requestSubspaceAccess = useCallback(async (spaceId: string) => {
    await fetchJsonBody(`/api/communities/${spaceId}/join`, 'POST', {});
    setLockedSubspaces(prev => prev.map(s => (s.id === spaceId ? { ...s, requested: true } : s)));
  }, []);

  const leaveSpace = useCallback(async (spaceId: string) => {
    await fetchJson(`/api/communities/${spaceId}/join`, { method: 'DELETE' });
    setMemberships(prev => {
      const next = new Map(prev);
      next.delete(spaceId);
      return next;
    });
    if (currentSpaceId === spaceId) {
      const remaining = Array.from(memberships.keys()).filter(id => id !== spaceId);
      const next = remaining[0] ?? null;
      setCurrentSpaceId(next);
      try { if (next) localStorage.setItem(CURRENT_SPACE_KEY, next); else localStorage.removeItem(CURRENT_SPACE_KEY); } catch {}
    }
  }, [currentSpaceId, memberships]);

  const refreshSpace = useCallback(async () => {
    await Promise.all([loadAllSpaces(), loadUserSpaces()]);
  }, [loadAllSpaces, loadUserSpaces]);

  const joinedSpaces = useMemo(
    () =>
      spaces
        .filter(c => memberships.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [spaces, memberships]
  );

  // Use the stored selection when it still resolves to a space the user is
  // a MEMBER of; otherwise fall back to a joined space. Resolving
  // against memberships (not the full visible list, which includes public
  // spaces anyone can discover) matters because the stored id may belong to a
  // different account that used this browser — without the membership check a
  // signed-in user could land "inside" a public space they never joined. A
  // brand-new member has joined nothing and resolves to null — nobody is
  // given a space; they create or join one.
  //
  // The fallback prefers a TOP-LEVEL space over a sub-space. `joinedSpaces` is
  // sorted by name, so the plain first entry handed someone a sub-space
  // whenever one happened to sort ahead of its parent — landing them inside a
  // narrow room (one working group, one cohort) rather than the space that
  // contains it, and making the default depend on the alphabet.
  const currentSpace = useMemo(
    () =>
      joinedSpaces.find(c => c.id === currentSpaceId) ??
      joinedSpaces.find(c => !c.parentId) ??
      joinedSpaces[0] ??
      null,
    [currentSpaceId, joinedSpaces]
  );

  // Derive isAdmin from the resolved current space. Managing a space
  // means holding one of its aliases marked `admin` — resolved server-side, so
  // super-admins are already folded in here.
  const isAdmin = currentSpace ? memberships.get(currentSpace.id) === true : false;
  const manages = useCallback((spaceId: string) => memberships.get(spaceId) === true, [memberships]);

  const value = useMemo<SpaceContextValue>(
    () => ({
      spaces,
      currentSpace,
      joinedSpaces,
      lockedSubspaces,
      setCurrentSpace,
      joinSpace,
      leaveSpace,
      refreshSpace,
      requestSubspaceAccess,
      loading,
      error,
      isAdmin,
      manages,
    }),
    [
      spaces,
      currentSpace,
      joinedSpaces,
      lockedSubspaces,
      setCurrentSpace,
      joinSpace,
      leaveSpace,
      refreshSpace,
      requestSubspaceAccess,
      loading,
      error,
      isAdmin,
      manages,
    ]
  );

  return (
    <SpaceContext.Provider value={value}>
      {children}
    </SpaceContext.Provider>
  );
}
