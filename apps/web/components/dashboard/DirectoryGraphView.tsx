'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import GraphWithTable, { type GraphLayoutData } from '@/components/graph/GraphWithTable';
import { useCommunityGraphData } from '@/hooks/useCommunityGraphData';
import { findBestMatchingNodeId } from '@/lib/graphUtils';
import type { CommunityAlias } from '@/lib/types';

// The graph view unmounts whenever the user switches to grid/table, so keep the
// last known layout per community for the session. A remount then restores the
// frozen layout immediately instead of waiting on (or re-running) anything.
// Updated on every persist so it never lags behind the server copy.
const layoutCache = new Map<string, GraphLayoutData | null>();

interface DirectoryGraphViewProps {
  /** Current value of the graph search box (drives focus + dimming). */
  searchTerm: string;
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
}: DirectoryGraphViewProps) {
  const { graphData, loading, error, community } = useCommunityGraphData();

  // ── Saved layout (per community) ───────────────────────────────────────────
  // undefined = still loading, null = none saved, object = restore it.
  const [layout, setLayout] = useState<GraphLayoutData | null | undefined>(() =>
    community?.id && layoutCache.has(community.id) ? layoutCache.get(community.id) : undefined
  );

  useEffect(() => {
    const id = community?.id;
    if (!id) return;
    if (layoutCache.has(id)) {
      setLayout(layoutCache.get(id));
      return;
    }
    let cancelled = false;
    setLayout(undefined);
    fetch(`/api/communities/${id}/graph/layout`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled) return;
        const next = (d as GraphLayoutData | null) ?? null;
        layoutCache.set(id, next);
        setLayout(next);
      })
      .catch(() => { if (!cancelled) setLayout(null); });
    return () => { cancelled = true; };
  }, [community?.id]);

  // Fire-and-forget save. The canvas already debounces camera changes and only
  // emits on settle/drag, so a second debounce here would just add latency.
  const handlePersistLayout = useCallback((next: GraphLayoutData) => {
    const id = community?.id;
    if (!id) return;
    layoutCache.set(id, next);
    fetch(`/api/communities/${id}/graph/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    }).catch(() => {});
  }, [community?.id]);

  // ── Text search dims non-matching nodes (the full graph stays visible) ──────
  const dimmedNodeIds = useMemo<Set<string>>(() => {
    const normalized = searchTerm.trim().toLowerCase();
    if (!normalized) return new Set();
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
  }, [graphData, searchTerm]);

  const focusedNodeId = useMemo<string | null>(() => {
    const trimmed = searchTerm.trim();
    if (!trimmed) return null;
    return findBestMatchingNodeId(graphData.nodes, trimmed);
  }, [searchTerm, graphData.nodes]);

  return (
    <>
      <GraphWithTable
        activeTab="graph"
        dataOverride={graphData}
        loadingOverride={loading || layout === undefined}
        errorOverride={error}
        focusNodeId={focusedNodeId}
        dimmedNodeIds={dimmedNodeIds}
        nodeTypes={community?.nodeTypes}
        communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
        initialLayout={layout ?? null}
        onPersistLayout={handlePersistLayout}
      />
    </>
  );
}
