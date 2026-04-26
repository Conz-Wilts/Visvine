'use client';

import { useState, useEffect, useRef } from 'react';
import type { NBNode } from '@/lib/types';

export interface ProfileConnection {
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
  communityCount: number;
  connections: ProfileConnection[];
}

// Module-level cache shared across all hook instances
const nodeProfileCache = new Map<string, { data: NodeProfileData; timestamp: number }>();
const CACHE_TTL = 60_000; // 60 seconds

// Deduplicate in-flight requests
const inFlightRequests = new Map<string, Promise<NodeProfileData>>();

export function fetchNodeProfile(nodeId: string): Promise<NodeProfileData> {
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

export function useNodeProfile(nodeId: string | null) {
  const [data, setData] = useState<NodeProfileData | null>(() => {
    if (!nodeId) return null;
    const cached = nodeProfileCache.get(nodeId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodeIdRef = useRef(nodeId);

  useEffect(() => {
    nodeIdRef.current = nodeId;
    if (!nodeId) {
      setData(null);
      return;
    }

    // Check cache first
    const cached = nodeProfileCache.get(nodeId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      setData(cached.data);
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
