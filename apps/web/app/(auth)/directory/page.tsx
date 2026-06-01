'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import ChatInterface from '@/components/chat/ChatInterface';
import SearchAndFilters from '@/components/dashboard/SearchAndFilters';
import NodeGrid from '@/components/dashboard/NodeGrid';
import CrmDirectoryTable from '@/components/crm/CrmDirectoryTable';
import NodeDetailsSidebar from '@/components/graph/NodeDetailsSidebar';
import { useDirectoryNodes } from '@/hooks/useDirectoryNodes';
import { clearGraphCache } from '@/hooks/useCommunityGraphData';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useDashboardSearch } from '@/hooks/useDashboardSearch';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import type { DirectoryItem } from '@/components/dashboard/types';
import { getNodeTypeConfig, DEFAULT_NODE_TYPES } from '@/lib/types';
import type { NBNode, CommunityAlias, SemanticSearchResult } from '@/lib/types';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { FilterDropdown, SortDropdown } from '@/components/dashboard/FilterDropdown';
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

// Semantic results carry a smaller payload; the grid only needs the card fields.
function semanticResultToGridItem(r: SemanticSearchResult): DirectoryItem {
  return {
    id: r.id, name: r.name, type: r.type, alias: r.alias,
    subtitle: r.subtitle, location: r.location, tags: r.tags,
    company_name: r.metadata?.company_name as string | undefined,
    company_image_url: r.metadata?.company_image_url as string | undefined,
  };
}

// Table rows additionally surface the match explanation + similarity score.
function semanticResultToTableItem(r: SemanticSearchResult): DirectoryItem {
  return {
    id: r.id, name: r.name, type: r.type, alias: r.alias,
    subtitle: r.subtitle, location: r.location, url: r.url,
    bio: r.metadata?.bio as string | undefined,
    tags: r.tags,
    explanation: r.explanation, similarity: r.similarity,
  };
}

export default function DashboardPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState<DirectoryView>('grid');
  const [graphChatValue, setGraphChatValue] = useState('');
  const [graphEverOpened, setGraphEverOpened] = useState(false);
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAliases, setFilterAliases] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>('az');
  const [editMode, setEditMode] = useState(false);
  // Saves multi-type selection when entering table view so it can be restored on exit
  const savedFilterTypesRef = useRef<Set<string> | null>(null);
  const { setHeaderContent, setHeaderRight } = useHeader();
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

  const {
    semanticResults,
    sortedSemanticResults,
    isSemanticSearch,
    semanticLoading,
    semanticError,
    performSemanticSearch,
    clearSemanticSearch,
  } = useSemanticSearch();

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
    if (next === 'graph') setGraphEverOpened(true);
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
    if (selectedNode?.id === item.id) return;
    const node = nodes.find(n => n.id === item.id);
    if (node) setSelectedNode(node);
  }, [nodes, selectedNode]);

  const handleGraphChatChange = useCallback((value: string) => {
    setGraphChatValue(value);
    setSearchTerm(value);
    if (!value.trim() && isSemanticSearch) clearSemanticSearch();
  }, [isSemanticSearch, clearSemanticSearch]);

  const handleGraphChatSubmit = useCallback((value: string) => performSemanticSearch(value, community?.id), [performSemanticSearch, community?.id]);
  const handleGridTableSearchSubmit = useCallback((value: string) => performSemanticSearch(value, community?.id), [performSemanticSearch, community?.id]);

  const handleClearSemantic = useCallback(() => {
    clearSemanticSearch();
    setSearchTerm('');
    setGraphChatValue('');
  }, [clearSemanticSearch]);

  // Admin edits invalidate both the directory list and the (separate) graph cache.
  const handleDataChanged = useCallback(() => {
    refresh();
    clearGraphCache(community?.id);
  }, [refresh, community?.id]);

  useEffect(() => {
    setHeaderContent(
      <div className="flex-1 flex items-center gap-3">
        <div className="flex-1 max-w-[280px] sm:max-w-md md:max-w-lg lg:max-w-2xl xl:max-w-3xl">
          <ChatInterface
            value={isGraphView ? graphChatValue : searchTerm}
            onChange={isGraphView ? handleGraphChatChange : setSearchTerm}
            onSubmit={isGraphView ? handleGraphChatSubmit : handleGridTableSearchSubmit}
            placeholder="Search…"
          />
        </div>
        {isSemanticSearch && (
          <button
            onClick={handleClearSemantic}
            className="flex h-8 items-center gap-2 rounded-full px-3 bg-surface-3 text-text-secondary text-xs font-semibold hover:bg-surface-3 transition-all shadow-sm shrink-0"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear
          </button>
        )}
      </div>
    );
    return () => setHeaderContent(null);
  }, [isGraphView, graphChatValue, searchTerm, isSemanticSearch,
      handleGraphChatChange, handleGraphChatSubmit, handleGridTableSearchSubmit,
      handleClearSemantic, setHeaderContent]);

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
          <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-0">
            <h1 className="text-4xl font-normal tracking-tight text-text-primary font-ginto">Directory</h1>
          </div>

          <div className="flex items-center gap-3 px-6 pt-3 pb-1">
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
                className="flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors"
                style={editMode
                  ? { borderColor: 'var(--color-brand-green)', backgroundColor: 'var(--color-brand-green)', color: '#fff' }
                  : { borderColor: 'var(--border-default, #e5e7eb)', backgroundColor: 'var(--surface-1, #fff)', color: 'var(--text-secondary, #374151)' }
                }
                title={editMode ? 'Exit edit mode' : 'Edit profiles'}
              >
                <Pencil className="h-3.5 w-3.5" />
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
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-text-muted hover:text-text-secondary hover:bg-surface-3 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear filters
              </button>
            )}
          </div>
        </>
      )}

      {/* ── Graph canvas — lazily mounted on first open, then kept warm ── */}
      {graphEverOpened && (
        <div
          className={`overflow-hidden rounded-xl ${isGraphView ? 'absolute inset-0 px-6' : 'absolute inset-0 px-6 pt-[100px]'}`}
          style={{ visibility: isGraphView ? 'visible' : 'hidden', pointerEvents: isGraphView ? 'auto' : 'none' }}
        >
          <DirectoryGraphView
            searchTerm={searchTerm}
            isSemanticSearch={isSemanticSearch}
            sortedSemanticResults={sortedSemanticResults}
            semanticLoading={semanticLoading}
            semanticError={semanticError}
            onClearSemantic={handleClearSemantic}
          />
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

            {isSemanticSearch && (
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-text-primary">Semantic Search Results</h2>
                <button
                  onClick={handleClearSemantic}
                  className="text-sm text-text-muted hover:text-text-primary"
                >
                  Clear search
                </button>
              </div>
            )}

            {semanticLoading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-green" />
                <p className="mt-4 text-text-muted">Searching...</p>
              </div>
            )}

            {isSemanticSearch && !semanticLoading && semanticError && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Search failed</p>
                <p className="mt-1 text-xs opacity-80">{semanticError}</p>
              </div>
            )}

            {isSemanticSearch && !semanticLoading && !semanticError && semanticResults.length === 0 && (
              <div className="text-center py-12">
                <p className="text-lg text-text-secondary">No results found</p>
                <p className="mt-2 text-sm text-text-muted">Try adjusting your search query</p>
              </div>
            )}

            {!semanticLoading && (
              currentView === 'grid' ? (
                <NodeGrid
                  items={isSemanticSearch ? sortedSemanticResults.map(semanticResultToGridItem) : filteredItems}
                  loading={loading}
                  onCardClick={handleItemClick}
                  nodeTypes={community?.nodeTypes}
                  communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
                />
              ) : (
                <CrmDirectoryTable
                  items={isSemanticSearch ? sortedSemanticResults.map(semanticResultToTableItem) : filteredItems}
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
              )
            )}

          </div>
        </div>
      )}

      <NodeDetailsSidebar
        node={selectedNode}
        onClose={() => setSelectedNode(null)}
        onExpandToFullPage={(node) => {
          // Full-screen profile is its own page (own URL), not an overlay on
          // /directory. The sidebar peek stays here; expanding navigates away.
          router.push(`/directory/${encodeURIComponent(node.id)}`);
        }}
      />
    </div>
  );
}
