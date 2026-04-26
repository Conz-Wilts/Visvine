'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GraphData } from '@/lib/types';
import { normalizeNode, normalizeLink } from '@/lib/graphUtils';
import { useCommunity } from '@/lib/contexts/CommunityContext';

// Simple in-memory cache for graph data
const graphCache = new Map<string, { data: GraphData; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

// Export a function to clear cache for a specific community (can be called from outside hook)
export function clearGraphCache(communityId?: string) {
  if (communityId) {
    graphCache.delete(communityId);
  } else {
    graphCache.clear();
  }
}

export function useCommunityGraphData() {
  const { currentCommunity, loading: communityLoading } = useCommunity();
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
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
      graphCache.delete(currentCommunity.id);
      setRefreshTrigger(prev => prev + 1);
    }
  }, [currentCommunity]);

  useEffect(() => {
    if (!currentCommunity) {
      // Only mark loading done if community context has finished loading too
      if (!communityLoading) setLoading(false);
      return;
    }

    const loadGraphData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Check if nodeTypes changed - if so, bust the cache
        const nodeTypesChanged = nodeTypesRef.current !== currentNodeTypesStr;
        if (nodeTypesChanged) {
          graphCache.delete(currentCommunity.id);
          nodeTypesRef.current = currentNodeTypesStr;
        }

        // Check cache first
        const cached = graphCache.get(currentCommunity.id);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          setGraphData(cached.data);
          setLoading(false);
          return;
        }

        // Cancel any pending requests
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        
        // Create new abort controller
        abortControllerRef.current = new AbortController();
        
        // Fetch from API which merges base graph + events
        const res = await fetch(`/api/communities/${currentCommunity.id}/graph`, {
          signal: abortControllerRef.current.signal,
        });
        
        if (!res.ok) {
          throw new Error(`Failed to load graph data: ${res.statusText}`);
        }
        
        const data: GraphData = await res.json();

        const nodes = data.nodes.map(normalizeNode);
        const links = data.links.map(normalizeLink);
        
        const processedData = { nodes, links };
        setGraphData(processedData);
        
        // Cache the result
        graphCache.set(currentCommunity.id, {
          data: processedData,
          timestamp: now,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return; // Request was cancelled, ignore
        }
        console.error(err);
        setError(err instanceof Error ? err.message : 'Failed to load community data');
        setGraphData({ nodes: [], links: [] });
      } finally {
        setLoading(false);
      }
    };

    loadGraphData();

    return () => {
      // Cancel the request if component unmounts
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [currentCommunity, communityLoading, currentNodeTypesStr, refreshTrigger]);

  return { graphData, loading, error, community: currentCommunity, refresh };
}




