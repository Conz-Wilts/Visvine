'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { invalidateRequestCachePrefix, swrFetch } from '@/features/shared/lib/requestCache';
import type { RecordsResponse, RecordTypesResponse } from '@/lib/records/api';

const typesKey = (spaceId: string) => `records:types:${spaceId}`;
const rowsKey = (spaceId: string, type: string) => `records:rows:${spaceId}:${type.toLowerCase()}`;
const recordsUrl = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/records`;

/**
 * The space's own types (member-invented, `scope: note`) and how many records
 * of each the viewer can read — the rows the Directory's type menu adds for
 * them. Cached like every read that outlives a mount; a field write
 * invalidates it.
 */
export function useRecordTypes(spaceId: string | null): RecordTypesResponse['types'] {
  const [types, setTypes] = useState<RecordTypesResponse['types']>([]);
  useEffect(() => {
    if (!spaceId) return;
    let cancelled = false;
    swrFetch(typesKey(spaceId), () => fetchJson<RecordTypesResponse>(recordsUrl(spaceId)), (data) => {
      if (!cancelled) setTypes(data.types);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [spaceId]);
  return types;
}

/** One invented type's records, while its table is the one showing. */
export function useRecords(
  spaceId: string | null,
  type: string | null,
): { data: RecordsResponse | null; error: string | null; refresh: () => void; save: (path: string, fields: Record<string, unknown>) => Promise<void> } {
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!spaceId || !type) {
      setData(null);
      return;
    }
    let cancelled = false;
    swrFetch(
      rowsKey(spaceId, type),
      () => fetchJson<RecordsResponse>(`${recordsUrl(spaceId)}?type=${encodeURIComponent(type)}`),
      (next) => {
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      },
    ).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the records');
    });
    return () => {
      cancelled = true;
    };
  }, [spaceId, type, round]);

  const refresh = useCallback(() => {
    if (spaceId) invalidateRequestCachePrefix(`records:`);
    setRound((n) => n + 1);
  }, [spaceId]);

  const save = useCallback(
    async (path: string, fields: Record<string, unknown>) => {
      if (!spaceId) return;
      await fetchJsonBody(recordsUrl(spaceId), 'PATCH', { path, fields });
      refresh();
    },
    [spaceId, refresh],
  );

  return { data, error, refresh, save };
}
