'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Resource } from '@/lib/types';
import { fetchJson } from '@/lib/fetchJson';

export function useResources(spaceId: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id so a slow earlier fetch can't overwrite a newer one
  // (e.g. on a fast space switch). Only the latest request applies state.
  const reqId = useRef(0);

  const refetch = useCallback(async () => {
    if (!spaceId) { setResources([]); return; }
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<Resource[]>(`/api/resources?space_id=${spaceId}`);
      if (myReq === reqId.current) setResources(data);
    } catch (e: unknown) {
      if (myReq === reqId.current) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }, [spaceId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { resources, loading, error, refetch };
}
