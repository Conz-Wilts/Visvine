'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useCommunity } from '@/lib/contexts/CommunityContext';

// Simple in-memory cache shared across every resource, keyed by
// `${resourceKey}:${communityId}` so distinct resources never collide.
const resourceCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

const cacheKey = (resourceKey: string, communityId: string) => `${resourceKey}:${communityId}`;

// Clear the cache for a resource (e.g. after an admin profile edit). With a
// communityId only that community's entry is dropped; without one every
// community's entry for that resource is cleared.
export function clearCachedCommunityResource(resourceKey: string, communityId?: string) {
  if (communityId) {
    resourceCache.delete(cacheKey(resourceKey, communityId));
  } else {
    const prefix = `${resourceKey}:`;
    for (const key of resourceCache.keys()) {
      if (key.startsWith(prefix)) resourceCache.delete(key);
    }
  }
}

interface UseCachedCommunityResourceArgs<T> {
  /** Namespaces this resource's cache entries (e.g. 'graph', 'directory'). */
  resourceKey: string;
  /** Builds the fetch path for the current community. */
  path: (communityId: string) => string;
  /** Maps the raw JSON response into the resource's shape. */
  parse: (json: unknown) => T;
  /** Value used before the first successful load. */
  initialData: T;
  /** Label in the thrown `Failed to load <label>: <status>` message. */
  errorLabel: string;
  /** Message surfaced on a non-abort fetch/parse failure. */
  fallbackError: string;
}

/**
 * Generic loader for a per-community resource backed by a 30s in-memory cache.
 *
 * Handles the shared lifecycle: community gating, nodeTypes-driven cache
 * busting, AbortController cancellation, and a `refresh` that drops the cache
 * entry and refetches. Concrete hooks (graph, directory) wrap this and expose
 * their own field names on top of `data`.
 */
export function useCachedCommunityResource<T>({
  resourceKey,
  path,
  parse,
  initialData,
  errorLabel,
  fallbackError,
}: UseCachedCommunityResourceArgs<T>) {
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Track nodeTypes changes to bust cache when they change
  const nodeTypesRef = useRef<string>('');
  const currentNodeTypesStr = JSON.stringify(currentCommunity?.nodeTypes || []);

  // Refresh function to clear cache and refetch
  const refresh = useCallback(() => {
    if (currentCommunity) {
      resourceCache.delete(cacheKey(resourceKey, currentCommunity.id));
      setRefreshTrigger(prev => prev + 1);
    }
  }, [currentCommunity, resourceKey]);

  useEffect(() => {
    if (!currentCommunity) {
      // Only mark loading done if community context has finished loading too
      if (!communityLoading) setLoading(false);
      return;
    }

    const key = cacheKey(resourceKey, currentCommunity.id);

    const loadResource = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check if nodeTypes changed - if so, bust the cache
        const nodeTypesChanged = nodeTypesRef.current !== currentNodeTypesStr;
        if (nodeTypesChanged) {
          resourceCache.delete(key);
          nodeTypesRef.current = currentNodeTypesStr;
        }

        // Check cache first
        const cached = resourceCache.get(key);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          setData(cached.data as T);
          setLoading(false);
          return;
        }

        // Cancel any pending requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        // Create new abort controller
        abortControllerRef.current = new AbortController();

        const res = await fetch(path(currentCommunity.id), {
          signal: abortControllerRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`Failed to load ${errorLabel}: ${res.statusText}`);
        }

        const json: unknown = await res.json();
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
  }, [currentCommunity, communityLoading, currentNodeTypesStr, refreshTrigger]);

  return { data, loading, error, community: currentCommunity, refresh };
}
