'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';

/**
 * How many members are waiting on a connector — the console's Connectors
 * badge. Read before the section is opened, and re-read when the panel
 * answers one.
 */
export function useConnectorRequestCount(): { count: number; refresh: () => void } {
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  const [count, setCount] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    if (!spaceId) {
      setCount(0);
      return;
    }
    fetchJson<{ pending: number }>(`/api/spaces/${encodeURIComponent(spaceId)}/connector-requests`)
      .then((body) => { if (live) setCount(body.pending); })
      // A count is decoration; a member opening the console sees no badge.
      .catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [spaceId, nonce]);

  return { count, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}
