'use client';

/**
 * The follow state for one profile: whether you follow them, and how many
 * people do. Read once per mount through the request cache, written straight
 * through — the API answers every call with the whole state, so the button
 * never has to guess what the count became.
 */

import { useCallback, useEffect, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { evictRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import type { FollowState } from '@/app/api/profile/[personId]/follow/route';

const EMPTY: FollowState = {
  following: false, followers: 0, followingCount: 0, followable: false, isSelf: false,
};

export function useFollow(nodeId: string) {
  const [state, setState] = useState<FollowState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const url = `/api/profile/${encodeURIComponent(nodeId)}/follow`;

  useEffect(() => {
    let cancelled = false;
    setState(EMPTY);
    swrFetch(url, () => fetchJson<FollowState>(url), (data) => {
      if (!cancelled) setState(data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [url]);

  const toggle = useCallback(async () => {
    setBusy(true);
    const next = !state.following;
    // Optimistic: the press reads as instant, the answer corrects the count.
    setState((prev) => ({
      ...prev,
      following: next,
      followers: Math.max(0, prev.followers + (next ? 1 : -1)),
    }));
    try {
      evictRequestCache(url);
      setState(await fetchJsonBody<FollowState>(url, next ? 'POST' : 'DELETE', {}));
    } catch {
      setState((prev) => ({
        ...prev,
        following: !next,
        followers: Math.max(0, prev.followers + (next ? -1 : 1)),
      }));
    } finally {
      setBusy(false);
    }
  }, [state.following, url]);

  return { ...state, busy, toggle };
}
