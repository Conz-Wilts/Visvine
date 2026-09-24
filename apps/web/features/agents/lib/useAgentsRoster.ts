'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import { swrFetch } from '@/features/shared/lib/requestCache';

export interface RosterResponse {
  agents: AgentSummary[];
  heartbeatAt: string | null;
  isAdmin: boolean;
  clean: { enabled: boolean; nextRunAt: string | null; runAsName: string | null } | null;
}

/**
 * The space's roster, followed. Polling, never a stream: every 4 s while
 * anything is running or due, otherwise every 30 s so "in 12 min" stays
 * right — and only while `live` and the tab is on screen. A table that merely
 * lists Agents in its type menu reads the cached copy, so switching between
 * the People and Space tables never re-asks for the roster.
 */
export function useAgentsRoster(
  spaceId: string | null,
  live: boolean,
): { data: RosterResponse | null; error: string | null; now: number; refresh: () => void } {
  const [data, setData] = useState<RosterResponse | null>(null);
  // Bumped to read again now — after a save, rather than at the next poll.
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const visible = usePageVisible();
  const follow = live && visible;

  useEffect(() => {
    if (!spaceId) {
      setData(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const key = `agents:roster:${spaceId}`;
    const read = () => fetchJson<RosterResponse>(`/api/spaces/${spaceId}/agents`);
    const load = async () => {
      try {
        // Followed: every poll is a real read. Listed: the cached roster
        // suffices, and a cold cache still costs the one request it always did.
        const next = follow
          ? await read()
          : await swrFetch(key, read, (cached) => {
              if (!cancelled) setData(cached);
            });
        if (cancelled) return;
        setData(next);
        setError(null);
        setNow(Date.now());
        if (!follow) return;
        const busy = next.agents.some((a) => a.state.status === 'running' || a.rowState === 'due');
        timer = setTimeout(load, busy ? 4000 : 30_000);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not load the agents');
        if (follow) timer = setTimeout(load, 10_000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, follow, round]);

  const refresh = useCallback(() => setRound((r) => r + 1), []);
  return { data, error, now, refresh };
}
