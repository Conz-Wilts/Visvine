'use client';

import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import SearchAndFilters from '@/components/dashboard/SearchAndFilters';
import NodeGrid from '@/components/dashboard/NodeGrid';
import CrmDirectoryTable from '@/components/crm/CrmDirectoryTable';
import GraphWithTable from '@/components/graph/GraphWithTable';
import NodeDetailsSidebar from '@/components/graph/NodeDetailsSidebar';
import FullProfileOverlay from '@/components/profile/FullProfileOverlay';
import { useCommunityGraphData } from '@/hooks/useCommunityGraphData';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { useDashboardSearch } from '@/hooks/useDashboardSearch';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import { filterGraphByNodeIds, findBestMatchingNodeId } from '@/lib/graphUtils';
import type { DirectoryItem } from '@/components/dashboard/types';
import { getNodeTypeConfig, DEFAULT_NODE_TYPES } from '@/lib/types';
import type { GraphData, NBNode } from '@/lib/types';
import { useHeader } from '@/lib/contexts/HeaderContext';
import { FilterDropdown, SortDropdown } from '@/components/dashboard/FilterDropdown';
import { Pencil } from 'lucide-react';

type DirectoryView = 'grid' | 'table' | 'graph';
type SortOrder = 'az' | 'za';

export default function DashboardPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentView, setCurrentView] = useState<DirectoryView>('grid');
  const [graphChatValue, setGraphChatValue] = useState('');
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);
  const [fullProfileNodeId, setFullProfileNodeId] = useState<string | null>(null);
  const [fullProfileInitialNode, setFullProfileInitialNode] = useState<NBNode | null>(null);
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set());
  const [filterAliases, setFilterAliases] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [sortOrder, setSortOrder] = useState<SortOrder>('az');
  const [editMode, setEditMode] = useState(false);
  // Saves multi-type selection when entering table view so it can be restored on exit
  const savedFilterTypesRef = useRef<Set<string> | null>(null);
  const { setHeaderContent } = useHeader();

  const { graphData, loading, error, community, refresh } = useCommunityGraphData();
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
    performSemanticSearch,
    clearSemanticSearch,
  } = useSemanticSearch();

  const savedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const graphDataHashRef = useRef<string>('');

  useEffect(() => { setGraphChatValue(searchTerm); }, [searchTerm]);

  // Always show all configured types (even those with zero nodes)
  const presentTypes = useMemo(() => {
    const configuredTypes = community?.nodeTypes ?? DEFAULT_NODE_TYPES;
    const configured = new Set(configuredTypes.map(t => t.name));
    // Also include any types that appear in data but aren't in config
    graphData.nodes.forEach(n => configured.add(n.type));
    return Array.from(configured).sort();
  }, [graphData.nodes, community?.nodeTypes]);

  const presentTags = useMemo(() => {
    const tags = new Set<string>();
    graphData.nodes.forEach(n => (n.tags ?? []).forEach(t => tags.add(t)));
    return Array.from(tags).sort();
  }, [graphData.nodes]);

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
    graphData.nodes.map(node => ({
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
      experience: node.metadata?.experience as string | undefined,
      education: node.metadata?.education as string | undefined,
      certifications: node.metadata?.certifications as string | undefined,
      languages: node.metadata?.languages as string | undefined,
    })),
  [graphData.nodes]);

  const { filteredItems: searchFilteredItems, normalizedSearch } = useDashboardSearch(items, searchTerm);

  // Apply type + alias + tag filters then sort
  const filteredItems = useMemo(() => {
    let result = searchFilteredItems;
    if (filterTypes.size > 0) result = result.filter(i => filterTypes.has(i.type));
    if (filterAliases.size > 0) result = result.filter(i => i.alias != null && filterAliases.has(i.alias));
    if (filterTags.size > 0) result = result.filter(i => (i.tags ?? []).some(t => filterTags.has(t)));
    return [...result].sort((a, b) =>
      sortOrder === 'az'
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name)
    );
  }, [searchFilteredItems, filterTypes, filterAliases, filterTags, sortOrder]);

  const filteredGraphData = useMemo<GraphData>(() => {
    if (graphData.nodes.length === 0) return { nodes: [], links: [] };

    if (isSemanticSearch && currentView === 'graph' && !semanticLoading) {
      if (sortedSemanticResults.length > 0) {
        const matchedNodeIds = new Set(sortedSemanticResults.map(r => r.id));
        return {
          nodes: graphData.nodes.filter(n => matchedNodeIds.has(n.id)),
          links: graphData.links.filter(l => {
            const s = typeof l.source === 'string' ? l.source : l.source.id;
            const t = typeof l.target === 'string' ? l.target : l.target.id;
            return matchedNodeIds.has(s) && matchedNodeIds.has(t);
          }),
        };
      }
      return { nodes: [], links: [] };
    }

    if (currentView === 'graph') return graphData;

    const allowedIds = new Set(filteredItems.map(i => i.id));
    if (allowedIds.size === graphData.nodes.length && normalizedSearch.length === 0) return graphData;
    return filterGraphByNodeIds(graphData, allowedIds);
  }, [graphData, filteredItems, normalizedSearch, currentView, isSemanticSearch, sortedSemanticResults, semanticLoading]);

  const dimmedNodeIds = useMemo<Set<string>>(() => {
    if (currentView !== 'graph' || !normalizedSearch || isSemanticSearch) return new Set();
    const ids = new Set<string>();
    graphData.nodes.forEach(node => {
      const matches =
        node.name.toLowerCase().includes(normalizedSearch) ||
        (node.subtitle || '').toLowerCase().includes(normalizedSearch) ||
        (node.location || '').toLowerCase().includes(normalizedSearch) ||
        (node.tags || []).some(t => t.toLowerCase().includes(normalizedSearch));
      if (!matches) ids.add(node.id);
    });
    return ids;
  }, [graphData, normalizedSearch, currentView, isSemanticSearch]);

  const handleItemClick = useCallback((item: DirectoryItem) => {
    if (selectedNode?.id === item.id) return;
    const node = graphData.nodes.find(n => n.id === item.id);
    if (node) setSelectedNode(node);
  }, [graphData.nodes, selectedNode]);

  const focusNodeFromInput = useCallback((rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) { setFocusedNodeId(null); return; }
    const nodes = currentView === 'graph' ? graphData.nodes : filteredGraphData.nodes;
    setFocusedNodeId(findBestMatchingNodeId(nodes, trimmed));
  }, [graphData.nodes, filteredGraphData.nodes, currentView]);

  const handleGraphChatChange = useCallback((value: string) => {
    setGraphChatValue(value);
    setSearchTerm(value);
    if (!isSemanticSearch) focusNodeFromInput(value);
    if (!value.trim() && isSemanticSearch) { clearSemanticSearch(); setFocusedNodeId(null); }
  }, [focusNodeFromInput, isSemanticSearch, clearSemanticSearch]);

  const handleGraphChatSubmit = useCallback((value: string) => performSemanticSearch(value, community?.id), [performSemanticSearch, community?.id]);
  const handleGridTableSearchSubmit = useCallback((value: string) => performSemanticSearch(value, community?.id), [performSemanticSearch, community?.id]);

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
            onClick={() => { clearSemanticSearch(); setSearchTerm(''); setGraphChatValue(''); }}
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
      clearSemanticSearch, setHeaderContent]);

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
            <SearchAndFilters currentView={currentView} onViewChange={handleViewChange} />
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
                  count: graphData.nodes.filter(n => n.type === t).length,
                  subOptions: aliases.length > 0 ? aliases.map(a => ({
                    value: a.name,
                    label: a.name,
                    color: a.color,
                    count: graphData.nodes.filter(n => n.type === t && n.alias === a.name).length,
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
                count: graphData.nodes.filter(n => (n.tags ?? []).includes(t)).length,
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

      {/* ── View toggle overlaid on graph ── */}
      {isGraphView && (
        <div className="absolute top-6 right-6 z-20">
          <SearchAndFilters currentView={currentView} onViewChange={handleViewChange} />
        </div>
      )}

      {/* ── Graph canvas — fills full container when active ── */}
      <div
        className={`overflow-hidden rounded-xl ${isGraphView ? 'absolute inset-0' : 'absolute inset-0 px-6 pt-[100px]'}`}
        style={{ visibility: isGraphView ? 'visible' : 'hidden', pointerEvents: isGraphView ? 'auto' : 'none' }}
      >
        <GraphWithTable
          activeTab="graph"
          dataOverride={filteredGraphData}
          loadingOverride={loading}
          errorOverride={error}
          focusNodeId={focusedNodeId}
          dimmedNodeIds={dimmedNodeIds}
          savedPositionsRef={savedPositionsRef}
          graphDataHashRef={graphDataHashRef}
          nodeTypes={community?.nodeTypes}
        />
      </div>

      {/* ── Graph overlays ── */}
      {isGraphView && isSemanticSearch && !semanticLoading && sortedSemanticResults.length > 0 && (
        <div className="absolute top-[88px] left-4 z-20 bg-surface-1 rounded-lg shadow-lg p-4 border border-border-default max-w-xs">
          <h3 className="font-semibold text-sm text-text-primary mb-2">🔍 Debug Info</h3>
          <div className="text-xs text-text-muted space-y-1">
            <p>Semantic results: <strong>{sortedSemanticResults.length}</strong></p>
            <p>Filtered nodes: <strong>{filteredGraphData.nodes.length}</strong></p>
            <p>Filtered links: <strong>{filteredGraphData.links.length}</strong></p>
            <details className="mt-2">
              <summary className="cursor-pointer text-brand-green hover:underline">View matched nodes</summary>
              <ul className="mt-1 ml-2 space-y-0.5">
                {sortedSemanticResults.slice(0, 5).map(r => (
                  <li key={r.id} className="text-text-secondary">• {r.name}</li>
                ))}
                {sortedSemanticResults.length > 5 && (
                  <li className="text-gray-500">...and {sortedSemanticResults.length - 5} more</li>
                )}
              </ul>
            </details>
          </div>
        </div>
      )}

      {isGraphView && isSemanticSearch && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          {semanticLoading ? (
            <div className="pointer-events-auto bg-surface-1 rounded-lg shadow-lg p-6 border border-border-default flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-green" />
              <p className="text-text-muted">Searching...</p>
            </div>
          ) : sortedSemanticResults.length === 0 ? (
            <div className="pointer-events-auto bg-surface-1 rounded-lg shadow-lg p-6 border border-border-default max-w-md text-center">
              <p className="text-lg font-medium text-text-primary mb-2">No results found</p>
              <p className="text-sm text-text-muted mb-4">
                This usually means your nodes don&apos;t have embeddings yet.<br />
                Run: <code className="bg-surface-3 px-2 py-1 rounded text-xs text-text-primary">node populate-embeddings.mjs</code>
              </p>
              <button
                onClick={() => { clearSemanticSearch(); setSearchTerm(''); }}
                className="px-4 py-2 bg-brand-green text-white rounded-lg hover:opacity-90 transition-all"
              >
                Clear search
              </button>
            </div>
          ) : null}
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
                  onClick={() => { clearSemanticSearch(); setSearchTerm(''); }}
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

            {isSemanticSearch && !semanticLoading && semanticResults.length === 0 && (
              <div className="text-center py-12">
                <p className="text-lg text-text-secondary">No results found</p>
                <p className="mt-2 text-sm text-text-muted">Try adjusting your search query</p>
              </div>
            )}

            {!semanticLoading && (
              currentView === 'grid' ? (
                <NodeGrid
                  items={isSemanticSearch ? sortedSemanticResults.map(r => ({
                    id: r.id, name: r.name, type: r.type, alias: r.alias,
                    subtitle: r.subtitle, location: r.location, tags: r.tags,
                    company_name: r.metadata?.company_name as string | undefined,
                    company_image_url: r.metadata?.company_image_url as string | undefined,
                  })) : filteredItems}
                  loading={loading}
                  onCardClick={handleItemClick}
                  nodeTypes={community?.nodeTypes}
                  communityAliases={community?.communityAliases as import('@/lib/types').CommunityAlias[] | undefined}
                />
              ) : (
                <CrmDirectoryTable
                  items={isSemanticSearch ? sortedSemanticResults.map(r => ({
                    id: r.id, name: r.name, type: r.type, alias: r.alias,
                    subtitle: r.subtitle, location: r.location, url: r.url,
                    bio: r.metadata?.bio as string | undefined,
                    tags: r.tags,
                    explanation: r.explanation, similarity: r.similarity,
                  })) : filteredItems}
                  loading={loading}
                  onRowClick={handleItemClick}
                  nodeTypes={community?.nodeTypes}
                  communityAliases={community?.communityAliases as import('@/lib/types').CommunityAlias[] | undefined}
                  communityId={community?.id}
                  isAdmin={isAdmin}
                  editMode={editMode}
                  activeType={filterTypes.size === 1 ? [...filterTypes][0] : (presentTypes[0] ?? 'person')}
                  onDataChanged={refresh}
                />
              )
            )}

          </div>
        </div>
      )}

      <NodeDetailsSidebar
        node={selectedNode}
        allLinks={graphData.links}
        allNodes={graphData.nodes}
        onClose={() => setSelectedNode(null)}
        onExpandToFullPage={(node) => {
          setFullProfileNodeId(node.id);
          setFullProfileInitialNode(node);
          // Delay sidebar close so overlay slides in first (seamless transition)
          setTimeout(() => setSelectedNode(null), 150);
        }}
      />

      <FullProfileOverlay
        nodeId={fullProfileNodeId}
        initialNode={fullProfileInitialNode ?? undefined}
        initialConnections={fullProfileNodeId ? graphData.links
          .filter(l => {
            const src = typeof l.source === 'string' ? l.source : l.source.id;
            const tgt = typeof l.target === 'string' ? l.target : l.target.id;
            return src === fullProfileNodeId || tgt === fullProfileNodeId;
          })
          .map(l => {
            const src = typeof l.source === 'string' ? l.source : l.source.id;
            const tgt = typeof l.target === 'string' ? l.target : l.target.id;
            const relatedId = src === fullProfileNodeId ? tgt : src;
            const related = graphData.nodes.find(n => n.id === relatedId);
            return related ? {
              id: related.id,
              name: related.name,
              type: related.type,
              image_url: related.image_url,
              subtitle: related.subtitle,
              relationship: l.relationship,
              since: l.since,
            } : null;
          })
          .filter(Boolean) as import('@/hooks/useNodeProfile').ProfileConnection[]
        : []}
        onClose={() => { setFullProfileNodeId(null); setFullProfileInitialNode(null); }}
      />
    </div>
  );
}
