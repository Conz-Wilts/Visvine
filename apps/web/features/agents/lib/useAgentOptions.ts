'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentOptions } from '@/lib/agents/options';

/**
 * The choices behind an agent's settings for one space — providers and their
 * key status, connectors, sibling agents. One fetch per mount; the list is
 * small and changes only when an admin adds a key or a connector.
 */
export function useAgentOptions(spaceId: string | null): { options: AgentOptions | null; loading: boolean; error: string | null } {
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchJson<AgentOptions>(`/api/communities/${encodeURIComponent(spaceId)}/agents/options`)
      .then((next) => {
        if (cancelled) return;
        setOptions(next);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load the options');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return { options, loading, error };
}
