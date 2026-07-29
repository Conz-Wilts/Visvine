'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDirectoryNodes } from '@/hooks/useDirectoryNodes';
import { clearContextCache } from '@/hooks/useCommunityContextData';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useDashboardSearch } from '@/hooks/useDashboardSearch';
import type { DirectoryItem } from '@/components/dashboard/types';
import { DEFAULT_NODE_TYPES } from '@/lib/types';
import type { NBNode } from '@/lib/types';

export type SortOrder = 'az' | 'za';

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
  };
}

/**
 * Shared search/filter/sort plumbing over the community directory, used by both
 * the Directory grid (/directory) and the Table tool (/table) so the two pages
 * stay behaviourally identical without duplicating the pipeline.
 */
export function useDirectoryBrowse() {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAliases, setFilterAliases] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>('az');
  const router = useRouter();

  const { nodes, loading, error, community, refresh } = useDirectoryNodes();
  const { isAdmin } = useCommunity();

  // Always show all configured types (even those with zero nodes).
  // Stored node.type casing ('person') can differ from the configured name
  // ('Person'); canonicalize by lowercase so the two collapse into a single
  // entry (preferring the configured casing) instead of showing duplicates.
  const presentTypes = useMemo(() => {
    const configuredTypes = community?.nodeTypes ?? DEFAULT_NODE_TYPES;
    const byLower = new Map<string, string>();
    for (const t of configuredTypes) byLower.set(t.name.toLowerCase(), t.name);
    nodes.forEach(n => {
      const key = n.type.toLowerCase();
      if (!byLower.has(key)) byLower.set(key, n.type);
    });
    return Array.from(byLower.values()).sort();
  }, [nodes, community?.nodeTypes]);

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
    return [...result].sort((a, b) =>
      sortOrder === 'az'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    );
  }, [searchFilteredItems, filterTypes, filterAliases, filterTags, sortOrder]);

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
    clearContextCache(community?.id);
  }, [refresh, community?.id]);

  return {
    nodes, loading, error, community, refresh, isAdmin,
    searchTerm, setSearchTerm,
    filterTypes, setFilterTypes,
    filterAliases, setFilterAliases,
    filterTags, setFilterTags,
    sortOrder, setSortOrder,
    presentTypes, presentTags,
    items, filteredItems,
    handleItemClick, handleDataChanged,
  };
}
