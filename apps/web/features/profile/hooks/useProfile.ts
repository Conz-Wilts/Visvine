'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FullProfile } from '@/lib/types/profile';
import { useProfileCache } from '@/features/shared/contexts/ProfileContext';

export function useProfile(personId: string | null) {
  const { getCached, setCache, patchCache } = useProfileCache();

  const [profile, setProfile] = useState<FullProfile | null>(
    () => (personId ? getCached(personId) : null)
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The cache is shared across every card/sidebar/page, so only ever write a
  // profile under the id it was fetched for. When personId changes there is a
  // render where `profile` still holds the previous person — writing that
  // under the new key poisons the cache and makes other cards display the
  // wrong person.
  useEffect(() => {
    if (profile && personId && profile.id === personId) setCache(personId, profile);
  }, [profile, personId, setCache]);

  // Tracks the id the hook currently wants, so an in-flight fetch for a
  // previous person is discarded instead of overwriting the current one.
  const latestIdRef = useRef(personId);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    try {
      const data: FullProfile = await fetch(`/api/profile/${encodeURIComponent(personId)}`).then(res => {
        if (!res.ok) throw new Error('Profile not found');
        return res.json();
      });
      if (latestIdRef.current !== personId) return; // stale response — drop it
      setProfile(data);
    } catch (e: unknown) {
      if (latestIdRef.current !== personId) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (latestIdRef.current === personId) setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    latestIdRef.current = personId;
    if (!personId) return;
    const cached = getCached(personId);
    if (cached) {
      setProfile(cached);
      return;
    }
    // Clear the previous person's profile so it never renders for — or gets
    // cached under — the new id while the fetch is in flight.
    setProfile(null);
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
