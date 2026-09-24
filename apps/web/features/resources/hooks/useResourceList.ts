'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { swrFetch, watchRequestCache, invalidateRequestCachePrefix } from '@/features/shared/lib/requestCache';
import { listQueryString, type ListQuery } from '@/lib/resources/shared/listQuery';
import type { ResourceView } from '@/lib/resources/shared/view';

interface Page {
  items: ResourceView[];
  nextOffset: number | null;
}

/** Every resources list of a space is cached under this prefix; a write invalidates it. */
const resourceListPrefix = (spaceId: string) => `resources:${spaceId}:`;

export function invalidateResourceLists(spaceId?: string | null) {
  invalidateRequestCachePrefix(spaceId ? resourceListPrefix(spaceId) : 'resources:');
}

/**
 * A page-at-a-time resources list (GET /api/spaces/<id>/resources), read
 * through the request cache so a tab switch or a back-navigation never asks
 * twice; any write to the space's resources invalidates it and it re-reads.
 */
export function useResourceList(spaceId: string | null, query: Partial<ListQuery>) {
  const qs = listQueryString(query);
  const key = spaceId ? `${resourceListPrefix(spaceId)}${qs}` : null;
  const [items, setItems] = useState<ResourceView[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [version, setVersion] = useState(0);
  const current = useRef(key);
  current.current = key;

  useEffect(() => {
    if (!key || !spaceId) return;
    let cancelled = false;
    setItems((prev) => (prev && current.current === key ? prev : null));
    swrFetch(
      key,
      () => fetchJson<Page>(`/api/spaces/${encodeURIComponent(spaceId)}/resources?${qs}`),
      (page) => {
        if (cancelled) return;
        setItems(page.items);
        setNextOffset(page.nextOffset);
      },
    ).catch(() => !cancelled && setItems([]));
    const unwatch = watchRequestCache([key], () => setVersion((v) => v + 1));
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [key, spaceId, qs, version]);

  const loadMore = useCallback(async () => {
    if (!spaceId || nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchJson<Page>(
        `/api/spaces/${encodeURIComponent(spaceId)}/resources?${listQueryString({ ...query, offset: nextOffset })}`,
      );
      setItems((prev) => [...(prev ?? []), ...page.items.filter((item) => !prev?.some((p) => p.id === item.id))]);
      setNextOffset(page.nextOffset);
    } finally {
      setLoadingMore(false);
    }
  }, [spaceId, nextOffset, loadingMore, query]);

  return { items, loadMore, hasMore: nextOffset !== null, loadingMore };
}
