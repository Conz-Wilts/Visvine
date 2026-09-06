'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';

export interface RosterResponse {
  agents: AgentSummary[];
  heartbeatAt: string | null;
  isAdmin: boolean;
  clean: { enabled: boolean; nextRunAt: string | null; runAsName: string | null } | null;
}

/**
 * The space's roster, followed. Polling, never a stream: every 4 s while
 * anything is running or due, otherwise every 30 s so "in 12 min" stays
 * right — and only while `live`, so a table that merely lists Agents in its
 * type menu fetches once.
 */
export function useAgentsRoster(spaceId: string | null, live: boolean): { data: RosterResponse | null; error: string | null; now: number } {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setData(null);
    if (!spaceId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const next = await fetchJson<RosterResponse>(`/api/communities/${spaceId}/agents`);
        if (cancelled) return;
        setData(next);
        setError(null);
        setNow(Date.now());
        if (!live) return;
        const busy = next.agents.some((a) => a.state.status === 'running' || a.rowState === 'due');
        timer = setTimeout(load, busy ? 4000 : 30_000);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load the agents');
        if (live) timer = setTimeout(load, 10_000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, live]);

  return { data, error, now };
}
