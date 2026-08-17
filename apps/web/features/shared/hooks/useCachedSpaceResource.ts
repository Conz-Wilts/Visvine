'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson, FetchJsonError } from '@/lib/fetchJson';

// Simple in-memory cache shared across every resource, keyed by
// `${resourceKey}:${spaceId}` so distinct resources never collide.
const resourceCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

// The nodeTypes signature each cache entry was loaded under, so a nodeTypes
// change busts the entry. Module-level (not a per-instance ref) because the
// consuming views unmount on every view toggle — a ref would reset to empty on
// each mount and wrongly bust the cache every time.
const nodeTypesSignatures = new Map<string, string>();

const cacheKey = (resourceKey: string, spaceId: string) => `${resourceKey}:${spaceId}`;

// Clear the cache for a resource (e.g. after an admin profile edit). With a
// spaceId only that space's entry is dropped; without one every
// space's entry for that resource is cleared.
export function clearCachedSpaceResource(resourceKey: string, spaceId?: string) {
  if (spaceId) {
    resourceCache.delete(cacheKey(resourceKey, spaceId));
  } else {
    const prefix = `${resourceKey}:`;
    for (const key of resourceCache.keys()) {
      if (key.startsWith(prefix)) resourceCache.delete(key);
    }
  }
}

interface UseCachedSpaceResourceArgs<T> {
  /** Namespaces this resource's cache entries (e.g. 'context', 'directory'). */
  resourceKey: string;
  /** Builds the fetch path for the current space. */
  path: (spaceId: string) => string;
  /** Maps the raw JSON response into the resource's shape. */
  parse: (json: unknown) => T;
  /** Value used before the first successful load. */
  initialData: T;
  /** Label in the thrown `Failed to load <label>: <status>` message. */
  errorLabel: string;
  /** Message surfaced on a non-abort fetch/parse failure. */
  fallbackError: string;
  /** How long a cached entry stays fresh (default 30s). */
  cacheDuration?: number;
}

/**
 * Generic loader for a per-space resource backed by a 30s in-memory cache.
 *
 * Handles the shared lifecycle: space gating, nodeTypes-driven cache
 * busting, AbortController cancellation, and a `refresh` that drops the cache
 * entry and refetches. Concrete hooks (context, directory) wrap this and expose
 * their own field names on top of `data`.
 */
export function useCachedSpaceResource<T>({
  resourceKey,
  path,
  parse,
  initialData,
  errorLabel,
  fallbackError,
  cacheDuration = CACHE_DURATION,
}: UseCachedSpaceResourceArgs<T>) {
  const { currentSpace, loading: spaceLoading } = useSpace();
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const currentNodeTypesStr = JSON.stringify(currentSpace?.nodeTypes || []);

  // Refresh function to clear cache and refetch
  const refresh = useCallback(() => {
    if (currentSpace) {
      resourceCache.delete(cacheKey(resourceKey, currentSpace.id));
      setRefreshTrigger(prev => prev + 1);
    }
  }, [currentSpace, resourceKey]);

  useEffect(() => {
    if (!currentSpace) {
      // Only mark loading done if space context has finished loading too
      if (!spaceLoading) setLoading(false);
      return;
    }

    const key = cacheKey(resourceKey, currentSpace.id);

    const loadResource = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check if nodeTypes changed - if so, bust the cache
        if (nodeTypesSignatures.get(key) !== currentNodeTypesStr) {
          resourceCache.delete(key);
          nodeTypesSignatures.set(key, currentNodeTypesStr);
        }

        const cached = resourceCache.get(key);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < cacheDuration) {
          setData(cached.data as T);
          setLoading(false);
          return;
        }

        // Cancel any pending requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();

        const json: unknown = await fetchJson(path(currentSpace.id), {
          signal: abortControllerRef.current.signal,
        }).catch((err: unknown) => {
          throw err instanceof FetchJsonError ? new Error(`Failed to load ${errorLabel}: ${err.message}`) : err;
        });
        const parsed = parse(json);
        setData(parsed);

        // Cache the result
        resourceCache.set(key, { data: parsed, timestamp: now });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // Request was cancelled, ignore
        }
        console.error(err);
        setError(err instanceof Error ? err.message : fallbackError);
        setData(initialData);
      } finally {
        setLoading(false);
      }
    };

    loadResource();

    return () => {
      // Cancel the request if component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSpace, spaceLoading, currentNodeTypesStr, refreshTrigger]);

  return { data, loading, error, space: currentSpace, refresh };
}
