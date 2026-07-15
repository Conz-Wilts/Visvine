'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { GraphData, NBNode, NodeTypeConfig, CommunityAlias, getNodeTypeConfig } from '@/lib/types';
import GraphDataTables from './GraphDataTables';
import { CARD_DIMENSIONS, OBSIDIAN_PHYSICS } from './utils/constants';
import { layoutGraph } from '@/lib/graph-layout/graphLayout';
import { placeIncrementally } from './utils/incrementalLayout';
import { fetchNodeProfile } from '@/hooks/useNodeProfile';
import { prefetchProfile } from '@/hooks/useProfile';
import { type SimNode, type SimLink, type Transform } from './CustomForceGraph';

/**
 * Version stamp baked into the persisted layout hash. Bumping it invalidates
 * every previously saved layout, forcing a one-time recompute with the
 * current engine, after which the fresh result is persisted under the
 * stamped hash. v2 → v3: composition switched from shelf-packing component
 * boxes (which read as a rigid grid with same-sized clusters in rows) to
 * force-directed circle packing (organic, roughly circular cloud).
 */
const LAYOUT_ALGO_VERSION = 'v3';

// d3-force + the canvas renderer add ~120KB to the bundle and are only used
// on the 'graph' tab. Defer until that tab mounts.
const CustomForceGraph = dynamic(() => import('./CustomForceGraph'), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading graph…</div>,
});

/* ============================================================================
   TYPE DEFINITIONS
   ============================================================================ */

/** Persisted force-directed layout for a community (see /api/communities/[id]/graph/layout). */
export interface GraphLayoutData {
  hash: string;
  transform: Transform;
  positions: Record<string, { x: number; y: number }>;
}

interface GraphWithTableProps {
  activeTab: 'graph' | 'data';
  dataOverride?: GraphData;
  loadingOverride?: boolean;
  errorOverride?: string | null;
  focusNodeId?: string | null;
  dimmedNodeIds?: Set<string>;
  savedPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  graphDataHashRef?: React.MutableRefObject<string>;
  nodeTypes?: NodeTypeConfig[];
  communityAliases?: CommunityAlias[];
  /** Server-saved layout to restore instead of recomputing (null = none saved). */
  initialLayout?: GraphLayoutData | null;
  /** Called (already debounced by the canvas) when the layout should be saved. */
  onPersistLayout?: (layout: GraphLayoutData) => void;
}

/* ============================================================================
   MAIN WRAPPER COMPONENT
   ============================================================================ */

const GraphWithTable: React.FC<GraphWithTableProps> = ({
  activeTab,
  dataOverride,
  loadingOverride,
  errorOverride,
  focusNodeId,
  dimmedNodeIds,
  savedPositionsRef: savedPositionsRefProp,
  graphDataHashRef: graphDataHashRefProp,
  nodeTypes,
  communityAliases,
  initialLayout,
  onPersistLayout,
}) => {
  const router = useRouter();
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);

  // Persistent storage for node positions across renders
  const localSavedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const localGraphDataHashRef = useRef<string>('');
  const savedPositionsRef = savedPositionsRefProp || localSavedPositionsRef;
  const graphDataHashRef = graphDataHashRefProp || localGraphDataHashRef;

  // Tracks the structure hash the user explicitly re-ran the layout for — makes
  // us ignore the saved server seed and recompute from scratch (then persist the
  // fresh result). Cleared naturally once the structure changes, which re-enables
  // a fresh server seed.
  const [recomputedHash, setRecomputedHash] = useState<string | null>(null);

  // Layouts persisted during this session, keyed by their version-prefixed
  // structure hash. The initialLayout prop stays frozen at its mount-time
  // fetch, so after a structure round-trip (filter on → off) the hash would
  // match that STALE copy again and resurrect pre-drag positions. Preferring
  // the freshest layout persisted this session keeps in-session drags. A ref
  // (not state) on purpose: a persist must not recreate simNodes — that would
  // re-init the canvas and replay the spawn fade-in.
  const sessionLayoutsRef = useRef<Map<string, GraphLayoutData>>(new Map());

  // Single click selects the node — this drives the focus highlight (the node +
  // its connections stay bright, everything else dims). Click the same node
  // again to clear the focus.
  const handleNodeClick = useCallback((node: NBNode) => {
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
    } else {
      setSelectedNode(node);
    }
  }, [selectedNode]);

  // Double click opens the node's detail page. Events have their own dedicated
  // page; everything else uses the generic node profile route. Mirrors the
  // grid/table's handleItemClick in directory/page.tsx.
  const handleNodeDoubleClick = useCallback((node: NBNode) => {
    if (String(node.type).toLowerCase() === 'event') {
      router.push(`/events/${encodeURIComponent(node.id)}`);
      return;
    }
    router.push(`/directory/${encodeURIComponent(node.id)}`);
  }, [router]);

  // Prefetch profile data on hover so it's ready before the user clicks
  const hoveredNodeIdRef = useRef<string | null>(null);
  const handleNodeHover = useCallback((node: NBNode | null) => {
    const id = node?.id ?? null;
    if (id === hoveredNodeIdRef.current) return;
    hoveredNodeIdRef.current = id;
    if (!id) return;
    fetchNodeProfile(id);
    if (id.startsWith('person:')) prefetchProfile(id);
  }, []);

  const loading = loadingOverride ?? false;
  const error = errorOverride ?? null;
  const graphData = useMemo<GraphData>(
    () => dataOverride ?? { nodes: [], links: [] },
    [dataOverride]
  );

  // Create a hash of the graph structure to detect when it actually changes
  const graphDataHash = useMemo(() => {
    const nodeIds = graphData.nodes.map(n => n.id).sort().join(',');
    const linkIds = graphData.links.map(l => `${l.source}-${l.target}`).sort().join(',');
    return `${nodeIds}::${linkIds}`;
  }, [graphData.nodes, graphData.links]);

  // Hash under which layouts are persisted/matched. The algo-version prefix
  // means saved layouts from older layout code never match → cold recompute.
  const layoutHash = `${LAYOUT_ALGO_VERSION}:${graphDataHash}`;

  // The saved layout is only reusable while it describes the current
  // structure AND was produced by the current layout algorithm. Layouts
  // persisted this session take precedence over the mount-time server copy.
  const serverSeed = useMemo(
    () => {
      if (recomputedHash === graphDataHash) return null;
      return (
        sessionLayoutsRef.current.get(layoutHash) ??
        (initialLayout && initialLayout.hash === layoutHash ? initialLayout : null)
      );
    },
    [initialLayout, layoutHash, graphDataHash, recomputedHash],
  );
  // Cold start = no reusable saved layout → compute a fresh layout.
  const coldStart = serverSeed === null;
  // Salt for "Re-run layout": bumping it re-rolls the deterministic engine
  // seed so a manual re-run actually produces a different arrangement.
  const [rerollNonce, setRerollNonce] = useState(0);

  // d3-force's forceLink mutates simLinks in place, swapping string endpoints
  // for node-object references once a simulation has run — unwrap either form.
  const endpointId = (v: SimLink['source']): string =>
    typeof v === 'string' ? v : String((v as SimNode).id);

  const simLinks = useMemo<SimLink[]>(() => {
    const nodeIdSet = new Set(graphData.nodes.map(n => String(n.id)));
    const seen = new Set<string>();
    return graphData.links
      .filter(link => {
        if (!nodeIdSet.has(String(link.source)) || !nodeIdSet.has(String(link.target))) return false;
        const a = String(link.source);
        const b = String(link.target);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(link => ({ ...link, source: String(link.source), target: String(link.target) }));
  }, [graphData.links, graphData.nodes]);

  // No exact-hash layout, but the structure usually only changed a little (a
  // few members joined/left, or a filter narrowed the node set). Reuse the
  // saved positions for every node we still know and place only the new ones —
  // skipping the full engine run (~1.5s of blocked main thread) entirely.
  // The user-facing "Re-run layout" button bypasses this on purpose.
  const incrementalLayout = useMemo<Map<string, { x: number; y: number }> | null>(() => {
    if (serverSeed !== null || graphData.nodes.length === 0) return null;
    if (recomputedHash === graphDataHash) return null;

    // Pick the algo-compatible saved layout (session or server) covering the
    // most of the current node set.
    const candidates = [...sessionLayoutsRef.current.values()];
    if (initialLayout) candidates.push(initialLayout);
    let best: GraphLayoutData | null = null;
    let bestCovered = 0;
    for (const c of candidates) {
      if (!c.hash.startsWith(`${LAYOUT_ALGO_VERSION}:`)) continue;
      const covered = graphData.nodes.reduce(
        (n, node) => n + (c.positions[String(node.id)] ? 1 : 0), 0,
      );
      if (covered > bestCovered) { best = c; bestCovered = covered; }
    }
    if (!best) return null;

    return placeIncrementally(
      graphData.nodes.map(n => String(n.id)),
      simLinks.map(l => ({ source: endpointId(l.source), target: endpointId(l.target) })),
      best.positions,
    );
  }, [serverSeed, graphData.nodes, simLinks, graphDataHash, recomputedHash, initialLayout]);

  // Fresh layout for cold starts, computed by the self-contained engine
  // (PivotMDS init → Barnes-Hut forces → guaranteed overlap removal) instead
  // of the old random-scatter + d3 burst, which stopped on alpha decay and
  // could settle — then persist — with overlapping cards. Cards are modelled
  // as their bounding circles, so "no circle overlap" implies "no card
  // overlap". The engine output is normalized to its viewport; divide the
  // reported scale back out to get world coordinates at true card size.
  const engineLayout = useMemo<Map<string, { x: number; y: number }> | null>(() => {
    if (serverSeed !== null || incrementalLayout !== null || graphData.nodes.length === 0) return null;
    const rectR = Math.hypot(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) / 2;
    const squareR = (CARD_DIMENSIONS.SQUARE_SIDE / 2) * Math.SQRT2; // circumscribed radius
    // 'hexagon' is rendered as a square (the hexagon look was retired), so it
    // takes the square collision radius.
    const radiusForShape = (shape: string) =>
      shape === 'square' || shape === 'hexagon' ? squareR : rectR;
    const result = layoutGraph(
      graphData.nodes.map(n => ({
        id: String(n.id),
        r: radiusForShape(getNodeTypeConfig(n.type, nodeTypes).shape),
      })),
      simLinks.map(l => ({ source: endpointId(l.source), target: endpointId(l.target) })),
      {
        width: 2000,
        height: 1400,
        padding: 0,
        nodePadding: 40,
        // K-proportional default margin (~340px at card scale) reads as
        // excessive whitespace between small components — one card width is
        // plenty of separation.
        componentMargin: 150,
        timeBudgetMs: 1500,
        seed: `${graphDataHash}:${rerollNonce}`,
      },
    );
    const inv = 1 / result.stats.scale;
    return new Map(
      result.nodes.map(p => [String(p.id), { x: (p.x - 1000) * inv, y: (p.y - 700) * inv }]),
    );
  }, [serverSeed, incrementalLayout, graphData.nodes, simLinks, nodeTypes, graphDataHash, rerollNonce]);

  // In-session drags (savedPositionsRef) take precedence, then the
  // server-saved layout, then the freshly computed engine layout.
  const simNodes = useMemo<SimNode[]>(() => {
    const structureChanged = graphDataHash !== graphDataHashRef.current;
    if (structureChanged) {
      graphDataHashRef.current = graphDataHash;
      savedPositionsRef.current.clear();
    }

    const seedPositions = serverSeed?.positions ?? null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return graphData.nodes.map((node, index) => {
      const savedPos =
        savedPositionsRef.current.get(node.id) ??
        seedPositions?.[node.id] ??
        incrementalLayout?.get(String(node.id)) ??
        engineLayout?.get(String(node.id));
      if (savedPos) {
        return { ...node, x: savedPos.x, y: savedPos.y, spawnTime: now, spawnIndex: index };
      }
      // Fallback only (engine covers every node): central scatter.
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.random() * OBSIDIAN_PHYSICS.seedRadius;
      return {
        ...node,
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        spawnTime: now,
        spawnIndex: index,
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData.nodes, graphDataHash, serverSeed, incrementalLayout, engineLayout, recomputedHash]);

  // Wrap the canvas's geometry callback to stamp it with the current
  // version-prefixed structure hash before handing it to the persistence layer,
  // remembering it session-side so a structure round-trip restores THIS layout
  // rather than the stale mount-time copy.
  const handlePersistLayout = useCallback((positions: Record<string, { x: number; y: number }>, transform: Transform) => {
    const layout: GraphLayoutData = { hash: layoutHash, transform, positions };
    sessionLayoutsRef.current.set(layout.hash, layout);
    onPersistLayout?.(layout);
  }, [onPersistLayout, layoutHash]);

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-4 bg-brand-bg">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-4 border-surface-3" />
          <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-green animate-spin" />
        </div>
        <p className="text-sm text-text-muted font-medium">
          {initialLayout ? 'Restoring layout…' : 'Loading graph…'}
        </p>
      </div>
    );
  }

  // Empty state
  if (!error && graphData.nodes.length === 0) {
    return activeTab === 'graph'
      ? <div className="flex items-center justify-center h-64 text-gray-600">No graph data matches the current filters.</div>
      : <GraphDataTables graphData={graphData} error={error} />;
  }

  // Graph view
  if (activeTab === 'graph') {
    return (
      <div className="relative h-full w-full bg-white">
        {error && (
          <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-red-700">
            {error}
          </div>
        )}
        <div className="h-full w-full">
          <CustomForceGraph
            nodes={simNodes}
            links={simLinks}
            // Click-selection drives focus highlight too; falls back to the external
            // focus prop (search/url) when nothing is clicked.
            focusNodeId={selectedNode?.id ?? focusNodeId ?? null}
            dimmedNodeIds={dimmedNodeIds}
            // Only auto-zoom for external focus, not on every click.
            autoZoomToFocus={selectedNode == null && focusNodeId != null}
            onNodeClick={handleNodeClick}
            onNodeDoubleClick={handleNodeDoubleClick}
            // Clicking empty canvas clears the click-selection (the focus highlight).
            onBackgroundClick={() => setSelectedNode(null)}
            onNodeHover={handleNodeHover}
            savedPositionsRef={savedPositionsRef}
            nodeTypes={nodeTypes}
            communityAliases={communityAliases}
            // A server restore, an incremental reuse, and a fresh engine layout
            // all arrive as final positions — freeze the simulation instead of
            // running a burst.
            coldStart={coldStart && incrementalLayout === null && engineLayout === null}
            initialTransform={serverSeed?.transform ?? null}
            // Fresh engine/incremental layouts (no saved camera) should be
            // persisted once the canvas has fitted them; a server restore
            // should not re-persist.
            persistOnRestore={serverSeed === null && (incrementalLayout !== null || engineLayout !== null)}
            onPersistLayout={handlePersistLayout}
            onRerunLayout={() => {
              setRecomputedHash(graphDataHash);
              setRerollNonce(n => n + 1);
              savedPositionsRef.current.clear();
              graphDataHashRef.current = '';
            }}
          />
        </div>
      </div>
    );
  }

  // Data table view
  return <GraphDataTables graphData={graphData} error={error} />;
};

export default GraphWithTable;
