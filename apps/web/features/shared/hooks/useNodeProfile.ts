'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NBNode } from '@/lib/types';
import { fetchJson } from '@/lib/fetchJson';

interface ProfileConnection {
  id: string;
  name: string;
  type: string;
  image_url?: string;
  subtitle?: string;
  relationship: string;
  since?: string;
}

export interface NodeProfileData {
  node: NBNode;
  connectionCount: number;
  spaceCount: number;
  connections: ProfileConnection[];
}

// Module-level cache shared across all hook instances
const nodeProfileCache = new Map<string, { data: NodeProfileData; timestamp: number }>();
const CACHE_TTL = 60_000; // 60 seconds

// Deduplicate in-flight requests
const inFlightRequests = new Map<string, Promise<NodeProfileData>>();

function fetchNodeProfile(nodeId: string): Promise<NodeProfileData> {
  const existing = inFlightRequests.get(nodeId);
  if (existing) return existing;

  const promise = fetchJson<NodeProfileData>(`/api/nodes/${encodeURIComponent(nodeId)}`)
    .finally(() => {
      inFlightRequests.delete(nodeId);
    });

  inFlightRequests.set(nodeId, promise);
  return promise;
}

/**
 * Fold an already-persisted field change (e.g. a rename saved from the context
 * header) into the cached profile, so the next mount paints the new value
 * instead of the 60s-stale one. No-op when the node was never fetched.
 */
export function patchCachedNodeProfile(nodeId: string, patch: Partial<NBNode>): void {
  const cached = nodeProfileCache.get(nodeId);
  if (!cached) return;
  nodeProfileCache.set(nodeId, {
    data: { ...cached.data, node: { ...cached.data.node, ...patch } },
    timestamp: Date.now(),
  });
}

export function useNodeProfile(nodeId: string | null) {
  const [data, setData] = useState<NodeProfileData | null>(() => {
    if (!nodeId) return null;
    const cached = nodeProfileCache.get(nodeId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    return null;
  });
  // True from the first render when the node isn't cached: the fetch effect
  // hasn't run yet, but "about to load" must not read as "resolved and empty".
  // The pane shell registers its tab bar off this flag on the first commit, so
  // a false start unmounted the bar for a frame on every profile navigation.
  const [loading, setLoading] = useState(() => {
    if (!nodeId) return false;
    const cached = nodeProfileCache.get(nodeId);
    return !(cached && Date.now() - cached.timestamp < CACHE_TTL);
  });
  const [error, setError] = useState<string | null>(null);
  // Bumped by `reload` to re-run the fetch effect; the cache entry is dropped
  // first so a retry after a failure actually goes back to the server.
  const [attempt, setAttempt] = useState(0);
  const nodeIdRef = useRef(nodeId);

  const reload = useCallback(() => {
    if (nodeId) nodeProfileCache.delete(nodeId);
    setAttempt((n) => n + 1);
  }, [nodeId]);

  useEffect(() => {
    nodeIdRef.current = nodeId;
    if (!nodeId) {
      setData(null);
      return;
    }

    const cached = nodeProfileCache.get(nodeId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetchNodeProfile(nodeId)
      .then((json) => {
        if (nodeIdRef.current !== nodeId) return; // stale
        nodeProfileCache.set(nodeId, { data: json, timestamp: Date.now() });
        setData(json);
        setLoading(false);
      })
      .catch((err) => {
        if (nodeIdRef.current !== nodeId) return;
        setError(err.message);
        setLoading(false);
      });
  }, [nodeId, attempt]);

  return { data, loading, error, reload };
}
