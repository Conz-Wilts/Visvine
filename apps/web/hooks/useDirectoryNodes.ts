'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { NBNode } from '@/lib/types';
import { normalizeNode } from '@/lib/graphUtils';
import { useCommunity } from '@/lib/contexts/CommunityContext';

// Simple in-memory cache for directory nodes (mirrors useCommunityGraphData)
const nodesCache = new Map<string, { data: NBNode[]; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

// Clear the cache for a community (e.g. after an admin profile edit)
export function clearDirectoryNodesCache(communityId?: string) {
  if (communityId) {
    nodesCache.delete(communityId);
  } else {
    nodesCache.clear();
  }
}

/**
 * Loads a community's directory nodes WITHOUT the link graph.
 *
 * This is the data source for the grid and table views, which never render
 * links. It deliberately avoids `/api/communities/[id]/graph` (and its edge
 * payload + force-graph bundle) so the directory loads only what it shows.
 */
export function useDirectoryNodes() {
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const [nodes, setNodes] = useState<NBNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Track nodeTypes changes to bust cache when they change
  const nodeTypesRef = useRef<string>('');
  const currentNodeTypesStr = JSON.stringify(currentCommunity?.nodeTypes || []);

  const refresh = useCallback(() => {
    if (currentCommunity) {
      nodesCache.delete(currentCommunity.id);
      setRefreshTrigger(prev => prev + 1);
    }
  }, [currentCommunity]);

  useEffect(() => {
    if (!currentCommunity) {
      if (!communityLoading) setLoading(false);
      return;
    }

    const loadNodes = async () => {
      try {
        setLoading(true);
        setError(null);

        const nodeTypesChanged = nodeTypesRef.current !== currentNodeTypesStr;
        if (nodeTypesChanged) {
          nodesCache.delete(currentCommunity.id);
          nodeTypesRef.current = currentNodeTypesStr;
        }

        const cached = nodesCache.get(currentCommunity.id);
        const now = Date.now();
        if (cached && now - cached.timestamp < CACHE_DURATION) {
          setNodes(cached.data);
          setLoading(false);
          return;
        }

        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        abortControllerRef.current = new AbortController();

        const res = await fetch(`/api/communities/${currentCommunity.id}/directory`, {
          signal: abortControllerRef.current.signal,
        });
        if (!res.ok) {
          throw new Error(`Failed to load directory: ${res.statusText}`);
        }

        const data: { nodes: NBNode[] } = await res.json();
        const processed = data.nodes.map(normalizeNode);
        setNodes(processed);
        nodesCache.set(currentCommunity.id, { data: processed, timestamp: now });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // cancelled — ignore
        }
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to load directory');
        setNodes([]);
      } finally {
        setLoading(false);
      }
    };

    loadNodes();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [currentCommunity, communityLoading, currentNodeTypesStr, refreshTrigger]);

  return { nodes, loading, error, community: currentCommunity, refresh };
}
