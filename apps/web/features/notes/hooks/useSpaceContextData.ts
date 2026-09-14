'use client';

import type { ContextData } from '@/lib/types';
import { normalizeNode, normalizeLink } from '@/lib/notes/context/normalize';
import {
  useCachedSpaceResource,
  clearCachedSpaceResource,
} from '@/features/shared/hooks/useCachedSpaceResource';

const RESOURCE_KEY = 'context';
const EMPTY_CONTEXT: ContextData = { nodes: [], links: [] };

// Export a function to clear cache for a specific space (can be called from outside hook)
export function clearContextCache(spaceId?: string) {
  clearCachedSpaceResource(RESOURCE_KEY, spaceId);
}

export function useSpaceContextData() {
  const { data, loading, error, space, refresh } = useCachedSpaceResource<ContextData>({
    resourceKey: RESOURCE_KEY,
    path: id => `/api/spaces/${id}/context`,
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

  return { contextData: data, loading, error, space, refresh };
}
