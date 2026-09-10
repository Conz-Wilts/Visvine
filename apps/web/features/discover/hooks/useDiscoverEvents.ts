'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { swrFetch } from '@/features/shared/lib/requestCache';
import type { DiscoverEvent } from '@/lib/discover/filters';

const KEY = 'discover:events';

/**
 * Every public upcoming event, anywhere. One read for the whole board, through
 * the shared cache: a tab toggle or a back-navigation paints the last list at
 * once and revalidates behind it.
 */
export function useDiscoverEvents(): { events: DiscoverEvent[]; loading: boolean; error: string | null } {
  const [events, setEvents] = useState<DiscoverEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    swrFetch(KEY, () => fetchJson<{ events: DiscoverEvent[] }>('/api/events/discover'), (body) => {
      if (cancelled) return;
      setEvents(body.events);
      setLoading(false);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : 'Could not load events');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return { events, loading, error };
}
