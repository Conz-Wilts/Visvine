'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Resource } from '@/lib/types';

export function useResources(communityId: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!communityId) { setResources([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/resources?community_id=${communityId}`);
      if (!res.ok) throw new Error('Failed to fetch resources');
      setResources(await res.json());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [communityId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { resources, loading, error, refetch };
}
