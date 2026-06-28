'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Resource } from '@/lib/types';

export function useResources(communityId: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Monotonic request id so a slow earlier fetch can't overwrite a newer one
  // (e.g. on a fast community switch). Only the latest request applies state.
  const reqId = useRef(0);

  const refetch = useCallback(async () => {
    if (!communityId) { setResources([]); return; }
    const myReq = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/resources?community_id=${communityId}`);
      if (!res.ok) throw new Error('Failed to fetch resources');
      const data = await res.json();
      if (myReq === reqId.current) setResources(data);
    } catch (e: unknown) {
      if (myReq === reqId.current) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      if (myReq === reqId.current) setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { resources, loading, error, refetch };
}
