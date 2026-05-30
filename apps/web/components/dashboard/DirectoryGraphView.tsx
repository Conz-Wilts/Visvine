'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GraphWithTable, { type GraphLayoutData } from '@/components/graph/GraphWithTable';
import { useCommunityGraphData } from '@/hooks/useCommunityGraphData';
import { findBestMatchingNodeId } from '@/lib/graphUtils';
import type { GraphData, SemanticSearchResult, CommunityAlias } from '@/lib/types';

interface DirectoryGraphViewProps {
  /** Current value of the graph search box (drives focus + dimming). */
  searchTerm: string;
  isSemanticSearch: boolean;
  sortedSemanticResults: SemanticSearchResult[];
  semanticLoading: boolean;
  semanticError: string | null;
  /** Clear semantic search + the search input. */
  onClearSemantic: () => void;
}

/**
 * The directory's graph view, fully decoupled from grid/table.
 *
 * It owns the heavy graph data fetch (nodes + links) and the d3-force bundle, so
 * neither loads until the user actually opens the graph. It also restores the
 * saved force-directed layout from the server instead of recomputing it.
 */
export default function DirectoryGraphView({
  searchTerm,
  isSemanticSearch,
  sortedSemanticResults,
  semanticLoading,
  semanticError,
  onClearSemantic,
}: DirectoryGraphViewProps) {
  const { graphData, loading, error, community } = useCommunityGraphData();

  // ── Saved layout (per community) ───────────────────────────────────────────
  // undefined = still loading, null = none saved, object = restore it.
  const [layout, setLayout] = useState<GraphLayoutData | null | undefined>(undefined);

  useEffect(() => {
    const id = community?.id;
    if (!id) return;
    let cancelled = false;
    setLayout(undefined);
    fetch(`/api/communities/${id}/graph/layout`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setLayout((d as GraphLayoutData | null) ?? null); })
      .catch(() => { if (!cancelled) setLayout(null); });
    return () => { cancelled = true; };
  }, [community?.id]);

  // Fire-and-forget save. The canvas already debounces camera changes and only
  // emits on settle/drag, so a second debounce here would just add latency.
  const handlePersistLayout = useCallback((next: GraphLayoutData) => {
    const id = community?.id;
    if (!id) return;
    fetch(`/api/communities/${id}/graph/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }, [community?.id]);

  // ── Graph data shaping (semantic search narrows; text search dims) ──────────
  const filteredGraphData = useMemo<GraphData>(() => {
    if (graphData.nodes.length === 0) return { nodes: [], links: [] };

    if (isSemanticSearch && !semanticLoading) {
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

    return graphData;
  }, [graphData, isSemanticSearch, sortedSemanticResults, semanticLoading]);

  const dimmedNodeIds = useMemo<Set<string>>(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized || isSemanticSearch) return new Set();
    const ids = new Set<string>();
    graphData.nodes.forEach(node => {
      const matches =
        node.name.toLowerCase().includes(normalized) ||
        (node.subtitle || '').toLowerCase().includes(normalized) ||
        (node.location || '').toLowerCase().includes(normalized) ||
        (node.tags || []).some(t => t.toLowerCase().includes(normalized));
      if (!matches) ids.add(node.id);
    });
    return ids;
  }, [graphData, searchTerm, isSemanticSearch]);

  const focusedNodeId = useMemo<string | null>(() => {
    if (isSemanticSearch) return null;
    const trimmed = searchTerm.trim();
    if (!trimmed) return null;
    return findBestMatchingNodeId(graphData.nodes, trimmed);
  }, [searchTerm, isSemanticSearch, graphData.nodes]);

  return (
    <>
      <GraphWithTable
        activeTab="graph"
        dataOverride={filteredGraphData}
        loadingOverride={loading || layout === undefined}
        errorOverride={error}
        focusNodeId={focusedNodeId}
        dimmedNodeIds={dimmedNodeIds}
        nodeTypes={community?.nodeTypes}
        communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
        initialLayout={layout ?? null}
        onPersistLayout={handlePersistLayout}
      />

      {/* ── Semantic search debug panel ── */}
      {isSemanticSearch && !semanticLoading && sortedSemanticResults.length > 0 && (
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

      {/* ── Semantic search status overlay ── */}
      {isSemanticSearch && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          {semanticLoading ? (
            <div className="pointer-events-auto bg-surface-1 rounded-lg shadow-lg p-6 border border-border-default flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-green" />
              <p className="text-text-muted">Searching...</p>
            </div>
          ) : semanticError ? (
            <div className="pointer-events-auto bg-surface-1 rounded-lg shadow-lg p-6 border border-amber-300 dark:border-amber-700 max-w-md text-center">
              <p className="text-lg font-medium text-text-primary mb-2">Search failed</p>
              <p className="text-sm text-text-muted mb-4 break-words">{semanticError}</p>
              <button
                onClick={onClearSemantic}
                className="px-4 py-2 bg-brand-green text-white rounded-lg hover:opacity-90 transition-all"
              >
                Clear search
              </button>
            </div>
          ) : sortedSemanticResults.length === 0 ? (
            <div className="pointer-events-auto bg-surface-1 rounded-lg shadow-lg p-6 border border-border-default max-w-md text-center">
              <p className="text-lg font-medium text-text-primary mb-2">No results found</p>
              <p className="text-sm text-text-muted mb-4">
                This usually means your nodes don&apos;t have embeddings yet.<br />
                Run: <code className="bg-surface-3 px-2 py-1 rounded text-xs text-text-primary">node populate-embeddings.mjs</code>
              </p>
              <button
                onClick={onClearSemantic}
                className="px-4 py-2 bg-brand-green text-white rounded-lg hover:opacity-90 transition-all"
              >
                Clear search
              </button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
