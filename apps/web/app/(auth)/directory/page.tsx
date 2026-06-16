'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import ChatInterface from '@/components/chat/ChatInterface';
import SearchAndFilters from '@/components/dashboard/SearchAndFilters';
import NodeGrid from '@/components/dashboard/NodeGrid';
import CrmDirectoryTable from '@/components/crm/CrmDirectoryTable';
import { useDirectoryNodes } from '@/hooks/useDirectoryNodes';
import { clearGraphCache } from '@/hooks/useCommunityGraphData';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useDashboardSearch } from '@/hooks/useDashboardSearch';
import type { DirectoryItem } from '@/components/dashboard/types';
import { getNodeTypeConfig, DEFAULT_NODE_TYPES } from '@/lib/types';
import type { NBNode, CommunityAlias } from '@/lib/types';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { FilterDropdown, SortDropdown } from '@/components/dashboard/FilterDropdown';
import { PageTitle } from '@/components/ui';
import { Pencil } from 'lucide-react';

// The graph view pulls in d3-force + the canvas renderer. Defer the whole thing
// until the user opens the graph, so grid/table users never download it.
const DirectoryGraphView = dynamic(() => import('@/components/dashboard/DirectoryGraphView'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading graph…</div>
  ),
});

type DirectoryView = 'grid' | 'table' | 'graph';
type SortOrder = 'az' | 'za';

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
    openToWork: node.metadata?.openToWork as boolean | undefined,
  };
}

export default function DashboardPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState<DirectoryView>('grid');
  const [graphChatValue, setGraphChatValue] = useState('');
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAliases, setFilterAliases] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>('az');
  const [editMode, setEditMode] = useState(false);
  // Saves multi-type selection when entering table view so it can be restored on exit
  const savedFilterTypesRef = useRef<Set<string> | null>(null);
  const { setHeaderRight } = useHeader();
  const router = useRouter();

  const { nodes, loading, error, community, refresh } = useDirectoryNodes();
  const { isAdmin } = useCommunity();
  const isGraphView = currentView === 'graph';

  useEffect(() => {
    document.body.dataset.graphView = isGraphView ? 'true' : 'false';
    document.body.style.overflow = isGraphView ? 'hidden' : '';
    return () => {
      delete document.body.dataset.graphView;
      document.body.style.overflow = '';
    };
  }, [isGraphView]);

  useEffect(() => { setGraphChatValue(searchTerm); }, [searchTerm]);

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

  const handleViewChange = useCallback((next: DirectoryView) => {
    if (next === 'table' && currentView !== 'table') {
      // Entering table: save current selection, clamp to single type
      savedFilterTypesRef.current = new Set(filterTypes);
      if (filterTypes.size !== 1) {
        const firstType = filterTypes.size > 1
          ? ([...filterTypes].find(t => t.toLowerCase() === 'person') ?? [...filterTypes][0])
          : (presentTypes.find(t => t.toLowerCase() === 'person') ?? presentTypes[0] ?? null);
        setFilterTypes(firstType ? new Set([firstType]) : new Set());
        setFilterAliases(new Set());
      }
    } else if (next !== 'table' && currentView === 'table') {
      // Leaving table: restore saved multi-type selection
      if (savedFilterTypesRef.current !== null) {
        setFilterTypes(savedFilterTypesRef.current);
        savedFilterTypesRef.current = null;
      }
    }
    setCurrentView(next);
  }, [currentView, filterTypes, presentTypes]);

  const items = useMemo<DirectoryItem[]>(() =>
    nodes.map(toDirectoryItem),
  [nodes]);

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

  const handleGraphChatChange = useCallback((value: string) => {
    setGraphChatValue(value);
    setSearchTerm(value);
  }, []);

  // Admin edits invalidate both the directory list and the (separate) graph cache.
  const handleDataChanged = useCallback(() => {
    refresh();
    clearGraphCache(community?.id);
  }, [refresh, community?.id]);

  // The search bar lives on the page (under the title; floating over the graph),
  // not in the navbar. Shared between views so typing carries across toggles.
  const searchBar = (
    <div className="flex-1 flex items-center gap-3">
      <div className="flex-1">
        <ChatInterface
          value={isGraphView ? graphChatValue : searchTerm}
          onChange={isGraphView ? handleGraphChatChange : setSearchTerm}
          placeholder="Search…"
          hideSubmitButton
        />
      </div>
    </div>
  );

  // View toggle lives in the navbar, to the left of the profile icon.
  useEffect(() => {
    setHeaderRight(
      <SearchAndFilters currentView={currentView} onViewChange={handleViewChange} />
    );
    return () => setHeaderRight(null);
  }, [currentView, handleViewChange, setHeaderRight]);

  return (
    <div
      className="relative w-full"
      style={isGraphView
        ? { height: 'calc(100vh - 5rem - 3rem)', overflow: 'hidden' }
        : { minHeight: 'calc(100dvh - 56px)' }
      }
    >

      {/* ── Non-graph header: title + filters + view toggle ── */}
      {!isGraphView && (
        <>
          <PageTitle title="Directory" />

          <div className="flex justify-center px-6 pt-6">
            <div className="flex w-full max-w-2xl">{searchBar}</div>
          </div>

          <div className="flex items-center justify-center gap-3 px-6 pt-4 pb-1">
            <FilterDropdown
              label="Type"
              singleSelect={currentView === 'table'}
              options={presentTypes.map(t => {
                const aliases = (community?.communityAliases ?? []).filter(
                  a => a.nodeType.toLowerCase() === t.toLowerCase()
                );
                return {
                  value: t,
                  label: t,
                  count: nodes.filter(n => n.type.toLowerCase() === t.toLowerCase()).length,
                  subOptions: aliases.length > 0 ? aliases.map(a => ({
                    value: a.name,
                    label: a.name,
                    color: a.color,
                    count: nodes.filter(n => n.type.toLowerCase() === t.toLowerCase() && n.alias === a.name).length,
                  })) : undefined,
                };
              })}
              selected={filterTypes}
              onChange={next => { setFilterTypes(next); if (next.size === 0) setFilterAliases(new Set()); }}
              selectedSub={filterAliases}
              onChangeSub={setFilterAliases}
              getColor={t => getNodeTypeConfig(t, community?.nodeTypes).color}
            />
            <FilterDropdown
              label="Tag"
              options={presentTags.map(t => ({
                value: t,
                label: t,
                count: nodes.filter(n => (n.tags ?? []).includes(t)).length,
              }))}
              selected={filterTags}
              onChange={setFilterTags}
            />
            <SortDropdown value={sortOrder} onChange={setSortOrder} />

            {isAdmin && currentView === 'table' && (
              <button
                onClick={() => setEditMode(v => !v)}
                className="flex h-12 w-12 lg:h-10 lg:w-10 items-center justify-center rounded-2xl border shadow-sm transition-colors"
                style={editMode
                  ? { borderColor: 'var(--color-brand-green)', backgroundColor: 'var(--color-brand-green)', color: '#fff' }
                  : { borderColor: 'var(--border-default, #e5e7eb)', backgroundColor: 'var(--surface-1, #fff)', color: 'var(--text-secondary, #374151)' }
                }
                title={editMode ? 'Exit edit mode' : 'Edit profiles'}
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}

            {currentView === 'table' && (
              <span className="text-xs text-text-muted ml-1">Table shows one type at a time</span>
            )}

            {(
              (currentView !== 'table' && (filterTypes.size > 0 || filterAliases.size > 0)) ||
              filterTags.size > 0 ||
              sortOrder !== 'az'
            ) && (
              <button
                onClick={() => {
                  if (currentView !== 'table') { setFilterTypes(new Set()); setFilterAliases(new Set()); }
                  setFilterTags(new Set());
                  setSortOrder('az');
                }}
                className="flex h-12 lg:h-10 items-center gap-1.5 rounded-2xl px-4 text-sm lg:text-[13px] font-semibold text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear filters
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Graph view: search floats over the canvas ── */}
      {isGraphView && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-6">
          <div className="flex w-full">{searchBar}</div>
        </div>
      )}

      {/* ── Graph canvas — mounted only while the graph view is active. Switching
           away tears down the d3 simulation and canvas entirely; switching back
           restores the persisted layout (no re-simulation), so the unmount costs
           one cheap redraw instead of keeping the whole graph warm behind the
           grid. ── */}
      {isGraphView && (
        <div className="overflow-hidden rounded-xl absolute inset-0 px-6">
          <DirectoryGraphView searchTerm={searchTerm} />
        </div>
      )}

      {/* ── Grid / Table content ── */}
      {!isGraphView && (
        <div className="w-full px-6 pt-4 pb-8">
          <div className="flex flex-col gap-5">

            {error && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {currentView === 'grid' ? (
              <NodeGrid
                items={filteredItems}
                loading={loading}
                onCardClick={handleItemClick}
                nodeTypes={community?.nodeTypes}
                communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
              />
            ) : (
              <CrmDirectoryTable
                items={filteredItems}
                loading={loading}
                onRowClick={handleItemClick}
                nodeTypes={community?.nodeTypes}
                communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
                communityId={community?.id}
                isAdmin={isAdmin}
                editMode={editMode}
                activeType={filterTypes.size === 1 ? [...filterTypes][0] : (presentTypes[0] ?? 'person')}
                onDataChanged={handleDataChanged}
              />
            )}

          </div>
        </div>
      )}
    </div>
  );
}
