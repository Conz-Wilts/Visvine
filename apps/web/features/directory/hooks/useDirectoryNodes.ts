'use client';

import type { NBNode } from '@/lib/types';
import { normalizeNode } from '@/lib/notes/context/normalize';
import { useCachedCommunityResource } from '@/features/shared/hooks/useCachedCommunityResource';

const RESOURCE_KEY = 'directory';
const EMPTY_NODES: NBNode[] = [];

/**
 * Loads a community's directory nodes WITHOUT the link context.
 *
 * This is the data source for the grid and table views, which never render
 * links. It deliberately avoids `/api/communities/[id]/context` (and its edge
 * payload + force-context bundle) so the directory loads only what it shows.
 */
export function useDirectoryNodes() {
  const { data, loading, error, community, refresh } = useCachedCommunityResource<NBNode[]>({
    resourceKey: RESOURCE_KEY,
    path: id => `/api/communities/${id}/directory`,
    parse: json => (json as { nodes: NBNode[] }).nodes.map(normalizeNode),
    initialData: EMPTY_NODES,
    errorLabel: 'directory',
    fallbackError: 'Failed to load directory',
  });

  return { nodes: data, loading, error, community, refresh };
}
