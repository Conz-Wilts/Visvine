'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDirectoryNodes } from '@/features/directory/hooks/useDirectoryNodes';
import { clearContextCache } from '@/features/notes/hooks/useSpaceContextData';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useDashboardSearch } from '@/features/directory/hooks/useDashboardSearch';
import type { DirectoryItem } from '@/lib/types';
import { DEFAULT_NODE_TYPES } from '@/lib/types';
import { isOwnSpaceNode } from '@/lib/types/context';
import { isNodeTypeEnabled } from '@/lib/featureAccess';
import type { NBNode } from '@/lib/types';

// Maps a directory node into the full DirectoryItem shape the grid/table consume.
function toDirectoryItem(node: NBNode): DirectoryItem {
  return {
    id: node.id, name: node.name, type: node.type,
    alias: node.alias,
    subtitle: node.subtitle, location: node.location,
    url: node.url,
    bio: node.metadata?.bio as string | undefined,
    tags: node.tags, image_url: node.image_url,
    company_name: node.metadata?.company_name as string | undefined,
    company_image_url: node.metadata?.company_image_url as string | undefined,
    website: node.metadata?.website as string | undefined,
    linkedinUrl: node.metadata?.linkedinUrl as string | undefined,
    twitterUrl: node.metadata?.twitterUrl as string | undefined,
    phone: node.metadata?.phone as string | undefined,
    pronouns: node.metadata?.pronouns as string | undefined,
    metadata: node.metadata,
    via_space: node.via_space,
    createdAt: node.createdAt,
  };
}

/**
 * Shared search/filter plumbing over the space directory, used by both
 * the Directory's Grid and Table views so the two
 * stay behaviourally identical without duplicating the pipeline.
 */
export function useDirectoryBrowse() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAliases, setFilterAliases] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const router = useRouter();

  const { nodes: allNodes, loading, error, space, refresh } = useDirectoryNodes();
  const { isAdmin } = useSpace();

  // The space you are IN is never a card in its own directory — it's the
  // container, not an entry. New spaces no longer mint that node at all
  // (app/api/spaces/route.ts), but every space made before that still has
  // one, so it is filtered here rather than only at the source. Dropped up front
  // so it also stays out of the type filters, the search and the count.
  const nodes = useMemo(
    () => allNodes.filter(n => !isOwnSpaceNode({ id: n.id, spaceId: n.space_id })),
    [allNodes],
  );

  // Always show all configured types (even those with zero nodes) — except the
  // ones belonging to a switched-off feature, which shouldn't advertise a filter
  // for something the space doesn't have.
  //
  // Unrecognised types found on real nodes are folded back in, so a legacy or
  // hand-written type never becomes unfilterable. A type belonging to a
  // switched-off tool is NOT: those nodes don't reach the client any more (the
  // directory route filters them server-side), so a filter for them would sit
  // there matching nothing.
  //
  // A note-scoped type — one a member named on the draft surface — is skipped
  // for the same reason: nothing syncs a graph node for a note, so its filter
  // could never match anything. It comes back below if a real node ever wears
  // it, which is exactly the legacy-type rule.
  //
  // Stored node.type casing ('person') can differ from the configured name
  // ('Person'); canonicalize by lowercase so the two collapse into a single
  // entry (preferring the configured casing) instead of showing duplicates.
  const presentTypes = useMemo(() => {
    const featureConfig = space?.featureConfig ?? null;
    const configuredTypes = space?.nodeTypes ?? DEFAULT_NODE_TYPES;
    const byLower = new Map<string, string>();
    for (const t of configuredTypes) {
      if (t.scope === 'note') continue;
      if (!isNodeTypeEnabled(featureConfig, t.name)) continue;
      byLower.set(t.name.toLowerCase(), t.name);
    }
    nodes.forEach(n => {
      const key = n.type.toLowerCase();
      if (!byLower.has(key) && isNodeTypeEnabled(featureConfig, n.type)) byLower.set(key, n.type);
    });
    return Array.from(byLower.values()).sort();
  }, [nodes, space?.nodeTypes, space?.featureConfig]);

  const presentTags = useMemo(() => {
    const tags = new Set<string>();
    nodes.forEach(n => (n.tags ?? []).forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [nodes]);

  const items = useMemo<DirectoryItem[]>(() => nodes.map(toDirectoryItem), [nodes]);

  const { filteredItems: searchFilteredItems } = useDashboardSearch(items, searchTerm);

  // Apply type + alias + tag filters then sort
  const filteredItems = useMemo(() => {
    let result = searchFilteredItems;
    if (filterTypes.size > 0) {
      // Compare case-insensitively: filterTypes holds canonical names ('Person')
      // while stored item.type may be lowercase ('person').
      const wanted = new Set([...filterTypes].map(t => t.toLowerCase()));
      result = result.filter(i => wanted.has(i.type.toLowerCase()));
    }
    if (filterAliases.size > 0) result = result.filter(i => i.alias != null && filterAliases.has(i.alias));
    if (filterTags.size > 0) result = result.filter(i => (i.tags ?? []).some(t => filterTags.has(t)));
    return [...result].sort((a, b) => a.name.localeCompare(b.name));
  }, [searchFilteredItems, filterTypes, filterAliases, filterTags]);

  const handleItemClick = useCallback((item: DirectoryItem) => {
    // Events have their own dedicated detail page (EventDetailClient); send them
    // there instead of the generic node profile view.
    if (item.type.toLowerCase() === 'event') {
      router.push(`/events/${encodeURIComponent(item.id)}`);
      return;
    }
    router.push(`/directory/${encodeURIComponent(item.id)}`);
  }, [router]);

  // Admin edits invalidate both the directory list and the (separate) context cache.
  const handleDataChanged = useCallback(() => {
    refresh();
    clearContextCache(space?.id);
  }, [refresh, space?.id]);

  return {
    nodes, loading, error, space, refresh, isAdmin,
    searchTerm, setSearchTerm,
    filterTypes, setFilterTypes,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
    presentTypes, presentTags,
    items, filteredItems,
    handleItemClick, handleDataChanged,
  };
}
