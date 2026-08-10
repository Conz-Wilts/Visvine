'use client';

import type { ContextData } from '@/lib/types';
import { normalizeNode, normalizeLink } from '@/lib/notes/context/normalize';
import {
  useCachedCommunityResource,
  clearCachedCommunityResource,
} from '@/features/shared/hooks/useCachedCommunityResource';

const RESOURCE_KEY = 'context';
const EMPTY_CONTEXT: ContextData = { nodes: [], links: [] };

// Export a function to clear cache for a specific community (can be called from outside hook)
export function clearContextCache(communityId?: string) {
  clearCachedCommunityResource(RESOURCE_KEY, communityId);
}

export function useCommunityContextData() {
  const { data, loading, error, community, refresh } = useCachedCommunityResource<ContextData>({
    resourceKey: RESOURCE_KEY,
    path: id => `/api/communities/${id}/context`,
    // Fetch from API which merges base context + events
    parse: json => {
      const raw = json as ContextData;
      return {
        nodes: raw.nodes.map(normalizeNode),
        links: raw.links.map(normalizeLink),
      };
    },
    initialData: EMPTY_CONTEXT,
    errorLabel: 'context data',
    fallbackError: 'Failed to load space data',
    // The context payload (all nodes + links) is the heaviest fetch in the app
    // and the context view unmounts on every switch to grid/table. Keep it fresh
    // longer than the default 30s so toggling back doesn't re-download it;
    // every local mutation path already calls clearContextCache().
    cacheDuration: 5 * 60 * 1000,
  });

  return { contextData: data, loading, error, community, refresh };
}
