'use client';

import type { GraphData } from '@/lib/types';
import { normalizeNode, normalizeLink } from '@/lib/graphUtils';
import {
  useCachedCommunityResource,
  clearCachedCommunityResource,
} from '@/hooks/useCachedCommunityResource';

const RESOURCE_KEY = 'graph';
const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };

// Export a function to clear cache for a specific community (can be called from outside hook)
export function clearGraphCache(communityId?: string) {
  clearCachedCommunityResource(RESOURCE_KEY, communityId);
}

export function useCommunityGraphData() {
  const { data, loading, error, community, refresh } = useCachedCommunityResource<GraphData>({
    resourceKey: RESOURCE_KEY,
    path: id => `/api/communities/${id}/graph`,
    // Fetch from API which merges base graph + events
    parse: json => {
      const raw = json as GraphData;
      return {
        nodes: raw.nodes.map(normalizeNode),
        links: raw.links.map(normalizeLink),
      };
    },
    initialData: EMPTY_GRAPH,
    errorLabel: 'graph data',
    fallbackError: 'Failed to load community data',
  });

  return { graphData: data, loading, error, community, refresh };
}
