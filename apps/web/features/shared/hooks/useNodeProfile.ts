'use client';

import { useState, useEffect, useRef } from 'react';
import type { NBNode } from '@/lib/types';

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

  const promise = fetch(`/api/nodes/${encodeURIComponent(nodeId)}`)
    .then((res) => {
      if (!res.ok) throw new Error('Node not found');
      return res.json();
    })
    .finally(() => {
      inFlightRequests.delete(nodeId);
    });

  inFlightRequests.set(nodeId, promise);
  return promise;
}

/**
 * Seed the cache for a node we already hold, so its profile paints on first
 * render instead of fetching. Used by the note-first create commit: it just
 * created the node, so priming here is what makes the jump from the draft
 * surface to /directory/<id>?tab=context land without a skeleton frame.
 *
 * A brand-new node has no links and belongs to exactly the space it was
 * created in, hence the zeroed counts — the real numbers arrive with the next
 * revalidation, and there is nothing to show until then anyway.
 */
export function primeNodeProfile(nodeId: string, node: NBNode): void {
  nodeProfileCache.set(nodeId, {
    data: { node, connectionCount: 0, spaceCount: node.space_id ? 1 : 0, connections: [] },
    timestamp: Date.now(),
  });
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
  const nodeIdRef = useRef(nodeId);

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
  }, [nodeId]);

  return { data, loading, error };
}
