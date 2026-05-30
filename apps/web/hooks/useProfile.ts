'use client';

import { useState, useEffect, useCallback } from 'react';
import type { FullProfile } from '@/lib/profileTypes';
import { useProfileCache } from '@/lib/contexts/ProfileContext';

const prefetchCache = new Map<string, Promise<FullProfile>>();

export function prefetchProfile(personId: string): void {
  if (prefetchCache.has(personId)) return;
  const promise = fetch(`/api/profile/${encodeURIComponent(personId)}`)
    .then(res => { if (!res.ok) throw new Error('Profile not found'); return res.json() as Promise<FullProfile>; })
    .catch((err) => { prefetchCache.delete(personId); throw err; });
  prefetchCache.set(personId, promise);
}

export function useProfile(personId: string | null) {
  const { getCached, setCache, patchCache } = useProfileCache();

  const [profile, setProfile] = useState<FullProfile | null>(
    () => (personId ? getCached(personId) : null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && personId) setCache(personId, profile);
  }, [profile, personId, setCache]);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const prefetched = prefetchCache.get(personId);
      const data = prefetched
        ? await prefetched
        : await fetch(`/api/profile/${encodeURIComponent(personId)}`).then(res => {
            if (!res.ok) throw new Error('Profile not found');
            return res.json();
          });
      prefetchCache.delete(personId);
      setProfile(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    if (!personId) return;
    const cached = getCached(personId);
    if (cached) {
      setProfile(cached);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  const updateBasicInfo = useCallback(async (patch: Partial<FullProfile>) => {
    if (!personId) return;
    patchCache(personId, patch);
    setProfile(prev => prev ? { ...prev, ...patch } : prev);

    const res = await fetch(`/api/profile/${encodeURIComponent(personId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error('Update failed');
    const updated = await res.json();
    setProfile(prev => prev ? { ...prev, ...updated } : updated);
  }, [personId, patchCache]);

  return {
    profile, loading, error, reload: load,
    updateBasicInfo,
  };
}
