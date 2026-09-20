'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { cachedFetch } from '@/features/shared/lib/requestCache';

/**
 * How many connectors a space shows this person — the count beside Connectors
 * in the Directory's type menu. Decoration: a failed read is a zero.
 */
export function useConnectorCount(spaceId: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    if (!spaceId) {
      setCount(0);
      return;
    }
    cachedFetch(`connectors:count:${spaceId}`, () =>
      fetchJson<{ connectors: unknown[]; hidden?: unknown[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/connectors`),
    )
      .then((body) => { if (live) setCount(body.connectors.length + (body.hidden?.length ?? 0)); })
      .catch(() => { if (live) setCount(0); });
    return () => { live = false; };
  }, [spaceId]);
  return count;
}
