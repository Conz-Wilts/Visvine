'use client';

import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useContext, useRef, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Space } from '@/lib/types';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { createSafeContext } from './createSafeContext';
import type { LockedSubspace } from '@/lib/spaces/subspaceAccess';
import {
  isCanonicalSpaceUrl,
  isSpaceScopedPath,
  parseSpacePath,
  sameSectionIn,
  spaceUrlPrefix,
  withSpace,
  type SpaceUrlTarget,
} from '@/lib/spaces/shared/spaceUrl';
import { SPACE_COOKIE } from '@/lib/spaces/shared/spaceCookie';

interface SpaceContextValue {
  spaces: Space[];
  currentSpace: Space | null;
  joinedSpaces: Space[];
  /** Private sub-spaces of a space you are in, which you are not in: the
   *  locked rows the switcher and the context tree draw. */
  lockedSubspaces: LockedSubspace[];
  /** Stand in another space: go to `path` there (an unprefixed in-app path),
   *  or to the page you are on, as far as it exists in every space. The space
   *  is the URL, so switching is a navigation. */
  setCurrentSpace: (space: string | SpaceUrlTarget, path?: string) => void;
  /** An in-app href under the current space (`/directory` → `/s/acme/directory`). */
  spaceHref: (href: string) => string;
  /** Press Join. Resolves 'active' when the door was open, 'pending' when it
   *  was ask — the membership then waits on an admin of that space. */
  joinSpace: (spaceId: string, alias?: string) => Promise<'active' | 'pending'>;
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
  /** Whether the user holds a space's OWN admin alias (not standing through its parent). */
  administersDirectly: (spaceId: string) => boolean;
}

const [SpaceContext, useSpace] = createSafeContext<SpaceContextValue>('Space');
export { useSpace };

/**
 * `spaceHref` where there may be no provider (sign-in, an invite, marketing):
 * outside one, an href is returned as it is.
 */
export function useSpaceHref(): (href: string) => string {
  return useContext(SpaceContext)?.spaceHref ?? keepHref;
}

const keepHref = (href: string) => href;

// Storage key kept at its pre-rename spelling on purpose: changing it would
// drop every signed-in browser back to no space selected.
const CURRENT_SPACE_KEY = 'nb_current_space';

// The stored selection is read in a layout effect, not during render: the
// server has no localStorage, so a synchronous read would make the first client
// render disagree with the SSR'd HTML. Layout effects flush before children's
// passive effects and before paint, so consumers still see the restored
// space before they fetch, with no flash.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Remember a space for the next URL that names none (see spaceCookie.ts). */
function rememberSpace(space: SpaceUrlTarget) {
  try { localStorage.setItem(CURRENT_SPACE_KEY, space.id); } catch {}
  try {
    const value = spaceUrlPrefix(space).split('/').slice(2).join('/');
    document.cookie = `${SPACE_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  } catch {}
}

/** Minimal membership shape needed to hydrate the provider server-side. */
export interface InitialMembership {
  id: string;
  isAdmin: boolean;
  /** Holds the space's own admin alias (not standing gained through its parent). */
  directAdmin?: boolean;
}

interface SpaceProviderProps {
  children: ReactNode;
  /**
   * Server-fetched hydration data (same shapes the /api/data/spaces and
   * /api/user/spaces routes return). When BOTH are provided the mount
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
  const [memberships, setMemberships] = useState<Map<string, { isAdmin: boolean; directAdmin: boolean }>>(
    () => new Map((initialMemberships ?? []).map(m => [m.id, { isAdmin: m.isAdmin, directAdmin: m.directAdmin ?? m.isAdmin }]))
  );
  const [currentSpaceId, setCurrentSpaceId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  // The URL names the space whenever it can; the stored selection only
  // answers a page reached without one (a first visit, a page outside spaces).
  const urlSpace = useMemo(() => parseSpacePath(pathname ?? ''), [pathname]);
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
      '/api/data/spaces',
    );
    setSpaces(data.spaces || []);
    setLockedSubspaces(data.lockedSubspaces || []);
  }, []);

  const loadUserSpaces = useCallback(async () => {
    let data: { spaces?: Array<{ id: string; isAdmin?: boolean; directAdmin?: boolean }> };
    try {
      data = await fetchJson('/api/user/spaces');
    } catch {
      return; // failed — leave memberships as they are (401 already kicked to /signin)
    }
    const next = new Map<string, { isAdmin: boolean; directAdmin: boolean }>();
    for (const c of (data.spaces || [])) {
      next.set(c.id, { isAdmin: c.isAdmin === true, directAdmin: c.directAdmin ?? c.isAdmin === true });
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

  // Read through a ref so a caller holding an older `setCurrentSpace` (one
  // that just created or joined the space, then refreshed) still finds it.
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;

  const setCurrentSpace = useCallback((space: string | SpaceUrlTarget, path?: string) => {
    const id = typeof space === 'string' ? space : space.id;
    const known = spacesRef.current.find(s => s.id === id);
    const target: SpaceUrlTarget = typeof space === 'string'
      ? { id, parentId: known?.parentId ?? null }
      : { id, parentId: space.parentId ?? known?.parentId ?? null };
    setCurrentSpaceId(id);
    rememberSpace(target);
    const here = typeof window === 'undefined' ? '/home' : `${window.location.pathname}${window.location.search}`;
    router.push(path ? withSpace(path, target) : sameSectionIn(here, target));
  }, [router]);

  const joinSpace = useCallback(async (spaceId: string, alias?: string) => {
    const data = await fetchJsonBody<{ membership?: { status?: string } }>(`/api/spaces/${spaceId}/join`, 'POST', { alias });
    const status = data?.membership?.status === 'pending' ? 'pending' : 'active';
    // Only an open door makes a member; an ask leaves the row pending and the
    // space outside the viewer's list until an admin there says yes.
    if (status === 'active') setMemberships(prev => new Map(prev).set(spaceId, { isAdmin: false, directAdmin: false }));
    return status;
  }, []);

  // Asking is its own act: the membership lands `pending`, so the row stays
  // locked and only changes its label. Marking it here rather than refetching
  // keeps the button from offering itself a second time while an admin decides.
  const requestSubspaceAccess = useCallback(async (spaceId: string) => {
    await fetchJsonBody(`/api/spaces/${spaceId}/join`, 'POST', {});
    setLockedSubspaces(prev => prev.map(s => (s.id === spaceId ? { ...s, requested: true } : s)));
  }, []);

  const leaveSpace = useCallback(async (spaceId: string) => {
    await fetchJson(`/api/spaces/${spaceId}/join`, { method: 'DELETE' });
    setMemberships(prev => {
      const next = new Map(prev);
      next.delete(spaceId);
      return next;
    });
    if ((urlSpace?.spaceId ?? currentSpaceId) === spaceId) {
      const remaining = Array.from(memberships.keys()).filter(id => id !== spaceId);
      const next = remaining[0] ?? null;
      setCurrentSpaceId(next);
      try { if (next) localStorage.setItem(CURRENT_SPACE_KEY, next); else localStorage.removeItem(CURRENT_SPACE_KEY); } catch {}
      // Standing in the space just left: the URL has nothing to show any more.
      if (urlSpace) {
        const nextSpace = next ? spacesRef.current.find(s => s.id === next) : undefined;
        router.replace(nextSpace ? withSpace('/home', nextSpace) : '/spaces');
      }
    }
  }, [currentSpaceId, memberships, urlSpace, router]);

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
  //
  // A space the URL names is the answer or nothing: falling back to another
  // space would render one space's page under another's address. One the
  // viewer is not in is sent to its door below.
  const currentSpace = useMemo(
    () =>
      urlSpace
        ? joinedSpaces.find(c => c.id === urlSpace.spaceId) ?? null
        : joinedSpaces.find(c => c.id === currentSpaceId) ??
          joinedSpaces.find(c => !c.parentId) ??
          joinedSpaces[0] ??
          null,
    [urlSpace, currentSpaceId, joinedSpaces]
  );

  // Keep the URL honest about where it stands. A space you are in, under the
  // wrong house (or a room named without one), is re-addressed in place; a
  // space you are not in goes to its page, which offers its door — or says
  // nothing exists, for a room that is secret from you.
  useEffect(() => {
    if (loading) return;
    const search = typeof window === 'undefined' ? '' : window.location.search + window.location.hash;
    if (!urlSpace) {
      // A space page reached without a space (an old link in a fresh browser):
      // once the space is resolved, the address bar says which one.
      if (currentSpace && pathname && isSpaceScopedPath(pathname)) {
        router.replace(`${withSpace(pathname, currentSpace)}${search}`);
      }
      return;
    }
    if (currentSpace) {
      rememberSpace(currentSpace);
      if (!isCanonicalSpaceUrl(urlSpace, currentSpace)) {
        router.replace(`${spaceUrlPrefix(currentSpace)}${urlSpace.rest}${search}`);
      }
      return;
    }
    router.replace(`/spaces/${encodeURIComponent(urlSpace.spaceId)}`);
  }, [urlSpace, currentSpace, loading, pathname, router]);

  const spaceHref = useCallback((href: string) => withSpace(href, currentSpace), [currentSpace]);

  // Derive isAdmin from the resolved current space. Managing a space
  // means holding one of its aliases marked `admin` — resolved server-side, so
  // super-admins are already folded in here.
  const isAdmin = currentSpace ? memberships.get(currentSpace.id)?.isAdmin === true : false;
  const manages = useCallback((spaceId: string) => memberships.get(spaceId)?.isAdmin === true, [memberships]);
  // The standing that can hand a room's governance back on: its own admin
  // alias, not the parent's (docs/sub-spaces.md).
  const administersDirectly = useCallback((spaceId: string) => memberships.get(spaceId)?.directAdmin === true, [memberships]);

  const value = useMemo<SpaceContextValue>(
    () => ({
      spaces,
      currentSpace,
      joinedSpaces,
      lockedSubspaces,
      setCurrentSpace,
      spaceHref,
      joinSpace,
      leaveSpace,
      refreshSpace,
      requestSubspaceAccess,
      loading,
      error,
      isAdmin,
      manages,
      administersDirectly,
    }),
    [
      spaceHref,
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
      administersDirectly,
    ]
  );

  return (
    <SpaceContext.Provider value={value}>
      {children}
    </SpaceContext.Provider>
  );
}
