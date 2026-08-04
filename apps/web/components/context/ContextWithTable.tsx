'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { ContextData, NBNode, NodeTypeConfig, LinkTypeConfig, CommunityAlias, getNodeTypeConfig } from '@/lib/types';
import { CARD_DIMENSIONS, OBSIDIAN_PHYSICS } from './utils/constants';
import { layoutContext } from '@/lib/context/layout';
import { placeIncrementally } from './utils/incrementalLayout';
import { fetchNodeProfile } from '@/hooks/useNodeProfile';
import { prefetchProfile } from '@/hooks/useProfile';
import { isFolderNodeId, isAliasNodeId, folderCount, folderRadius, aliasRadius } from '@/lib/context/folderView';
import { isNoteNodeId, notePathOfNodeId, NOTE_NODE_RADIUS } from '@/lib/context/brainView';
import { noteHref } from '@/lib/notes/entities';
import { type SimNode, type SimLink, type Transform } from './ContextCanvas';

/**
 * Version stamp baked into the persisted layout hash. Bumping it invalidates
 * every previously saved layout, forcing a one-time recompute with the
 * current engine, after which the fresh result is persisted under the
 * stamped hash. v2 → v3: composition switched from shelf-packing component
 * boxes (which read as a rigid grid with same-sized clusters in rows) to
 * force-directed circle packing (organic, roughly circular cloud).
 * v3 → v4: node spacing opened up (nodePadding 40 → 72) for the folder view.
 */
const LAYOUT_ALGO_VERSION = 'v4';

/**
 * Version-prefixed structure hash under which a layout is stored and matched
 * (and which detects when the structure actually changes).
 */
function buildLayoutHash(data: ContextData): string {
  const nodeIds = data.nodes.map(n => n.id).sort().join(',');
  const linkIds = data.links.map(l => `${l.source}-${l.target}`).sort().join(',');
  return `${LAYOUT_ALGO_VERSION}:${nodeIds}::${linkIds}`;
}

// d3-force + the canvas renderer add ~120KB to the bundle and are only used
// on the 'context' tab. Defer until that tab mounts.
const ContextCanvas = dynamic(() => import('./ContextCanvas'), {
  ssr: false,
  loading: () => <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading context…</div>,
});

/* ============================================================================
   TYPE DEFINITIONS
   ============================================================================ */

/** Persisted force-directed layout for a community (see /api/communities/[id]/context/layout). */
export interface ContextLayoutData {
  hash: string;
  transform: Transform;
  positions: Record<string, { x: number; y: number }>;
}

interface ContextWithTableProps {
  dataOverride?: ContextData;
  loadingOverride?: boolean;
  errorOverride?: string | null;
  focusNodeId?: string | null;
  dimmedNodeIds?: Set<string>;
  savedPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  contextDataHashRef?: React.MutableRefObject<string>;
  nodeTypes?: NodeTypeConfig[];
  linkTypes?: LinkTypeConfig[];
  communityAliases?: CommunityAlias[];
  /** Server-saved layout to restore instead of recomputing (null = none saved). */
  initialLayout?: ContextLayoutData | null;
  /** Called (already debounced by the canvas) when the layout should be saved. */
  onPersistLayout?: (layout: ContextLayoutData) => void;
  /** Click on a folder or alias meta-node — the parent owns the expansion
   *  state and tells them apart by id (isFolderNodeId / isAliasNodeId). */
  onFolderOpen?: (node: NBNode) => void;
  /** Selection changed: an entity node was clicked (or the selection was
   *  cleared — same node re-clicked / background click). Lets the parent
   *  reveal the selected node's neighbourhood. */
  onNodeSelect?: (node: NBNode | null) => void;
  /**
   * Start positions for a structure transition (folder expand/collapse).
   * When set, the engine ALWAYS computes the final layout (force-directed,
   * crossing-reduced) and the canvas animates nodes from these seeds to it —
   * saved-layout shortcuts are bypassed so every transition untangles.
   */
  seedPositions?: ReadonlyMap<string, { x: number; y: number }> | null;
  /**
   * Prescriptive final layout (e.g. the home ring of the fully-collapsed
   * folder map). Takes the engine's place as the target — transitions still
   * glide into it.
   */
  layoutOverride?: ReadonlyMap<string, { x: number; y: number }> | null;
  /**
   * The node whose neighbourhood is currently revealed (search focus or click
   * selection). Its cluster is detached from the folders in the ENGINE's input
   * (drawn edges are untouched) so the layout spreads the neighbours around
   * the focused node instead of stringing them out toward their folders.
   */
  egoNodeId?: string | null;
}

/* ============================================================================
   MAIN WRAPPER COMPONENT
   ============================================================================ */

const ContextWithTable: React.FC<ContextWithTableProps> = ({
  dataOverride,
  loadingOverride,
  errorOverride,
  focusNodeId,
  dimmedNodeIds,
  savedPositionsRef: savedPositionsRefProp,
  contextDataHashRef: contextDataHashRefProp,
  nodeTypes,
  linkTypes,
  communityAliases,
  initialLayout,
  onPersistLayout,
  onFolderOpen,
  onNodeSelect,
  seedPositions = null,
  layoutOverride = null,
  egoNodeId = null,
}) => {
  const router = useRouter();
  const [selectedNode, setSelectedNode] = useState<NBNode | null>(null);

  // Persistent storage for node positions across renders
  const localSavedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const localContextDataHashRef = useRef<string>('');
  const savedPositionsRef = savedPositionsRefProp || localSavedPositionsRef;
  const contextDataHashRef = contextDataHashRefProp || localContextDataHashRef;

  // Layouts persisted during this session, keyed by their version-prefixed
  // structure hash. The initialLayout prop stays frozen at its mount-time
  // fetch, so after a structure round-trip (filter on → off) the hash would
  // match that STALE copy again and resurrect pre-drag positions. Preferring
  // the freshest layout persisted this session keeps in-session drags. A ref
  // (not state) on purpose: a persist must not recreate simNodes — that would
  // re-init the canvas and replay the spawn fade-in.
  const sessionLayoutsRef = useRef<Map<string, ContextLayoutData>>(new Map());

  // Single click selects the node — this drives the focus highlight (the node +
  // its connections stay bright, everything else dims). Click the same node
  // again to clear the focus.
  const handleNodeClick = useCallback((node: NBNode) => {
    // Folders and alias circles open instead of selecting — the click IS the
    // drill-in. The parent decides what to expand from the node itself.
    if (isFolderNodeId(String(node.id)) || isAliasNodeId(String(node.id))) {
      onFolderOpen?.(node);
      return;
    }
    if (selectedNode?.id === node.id) {
      setSelectedNode(null);
      onNodeSelect?.(null);
    } else {
      setSelectedNode(node);
      onNodeSelect?.(node);
    }
  }, [selectedNode, onFolderOpen, onNodeSelect]);

  // Double click opens the node's detail page. Events have their own dedicated
  // page; everything else uses the generic node profile route. Mirrors the
  // grid/table's handleItemClick in directory/page.tsx.
  const handleNodeDoubleClick = useCallback((node: NBNode) => {
    if (isFolderNodeId(String(node.id)) || isAliasNodeId(String(node.id))) return; // single click already opened it
    if (isNoteNodeId(String(node.id))) {
      router.push(noteHref(notePathOfNodeId(String(node.id))));
      return;
    }
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
    if (!id || isFolderNodeId(id) || isAliasNodeId(id) || isNoteNodeId(id)) return;
    fetchNodeProfile(id);
    if (id.startsWith('person:')) prefetchProfile(id);
  }, []);

  const loading = loadingOverride ?? false;
  const error = errorOverride ?? null;
  const contextData = useMemo<ContextData>(
    () => dataOverride ?? { nodes: [], links: [] },
    [dataOverride]
  );

  // Hash under which layouts are persisted/matched (and which detects when
  // the structure actually changes). The algo-version prefix means saved
  // layouts from older layout code never match → cold recompute.
  const layoutHash = useMemo(() => buildLayoutHash(contextData), [contextData]);
  const contextDataHash = layoutHash;

  // The saved layout is only reusable while it describes the current
  // structure AND was produced by the current layout algorithm. A layout
  // persisted THIS SESSION for this exact structure always wins — it carries
  // the user's drags, and restoring it keeps a selection click (which changes
  // nothing structurally) from re-running the engine and snapping drags away.
  // Otherwise a transition (seedPositions set) runs the engine and animates
  // into the result; a plain mount may restore the server copy.
  const serverSeed = useMemo(() => {
    const session = sessionLayoutsRef.current.get(layoutHash);
    if (session) return session;
    if (seedPositions) return null;
    return initialLayout && initialLayout.hash === layoutHash ? initialLayout : null;
  }, [initialLayout, layoutHash, seedPositions]);
  // Cold start = no reusable saved layout → compute a fresh layout.
  const coldStart = serverSeed === null;

  // d3-force's forceLink mutates simLinks in place, swapping string endpoints
  // for node-object references once a simulation has run — unwrap either form.
  const endpointId = (v: SimLink['source']): string =>
    typeof v === 'string' ? v : String((v as SimNode).id);

  const simLinks = useMemo<SimLink[]>(() => {
    const nodeIdSet = new Set(contextData.nodes.map(n => String(n.id)));
    const seen = new Set<string>();
    return contextData.links
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
  }, [contextData.links, contextData.nodes]);

  // No exact-hash layout, but the structure usually only changed a little (a
  // few members joined/left, or a filter narrowed the node set). Reuse the
  // saved positions for every node we still know and place only the new ones —
  // skipping the full engine run (~1.5s of blocked main thread) entirely.
  const incrementalLayout = useMemo<Map<string, { x: number; y: number }> | null>(() => {
    // Transitions skip incremental reuse too — geometric insertion has no
    // force model and no crossing pass; the engine owns transition layouts.
    if (serverSeed !== null || seedPositions !== null || contextData.nodes.length === 0) return null;

    // Pick the algo-compatible saved layout (session or server) covering the
    // most of the current node set.
    const candidates = [...sessionLayoutsRef.current.values()];
    if (initialLayout) candidates.push(initialLayout);
    let best: ContextLayoutData | null = null;
    let bestCovered = 0;
    for (const c of candidates) {
      if (!c.hash.startsWith(`${LAYOUT_ALGO_VERSION}:`)) continue;
      const covered = contextData.nodes.reduce(
        (n, node) => n + (c.positions[String(node.id)] ? 1 : 0), 0,
      );
      if (covered > bestCovered) { best = c; bestCovered = covered; }
    }
    if (!best) return null;

    return placeIncrementally(
      contextData.nodes.map(n => String(n.id)),
      simLinks.map(l => ({ source: endpointId(l.source), target: endpointId(l.target) })),
      best.positions,
    );
  }, [serverSeed, seedPositions, contextData.nodes, simLinks, initialLayout]);

  // Fresh layout for cold starts, computed by the self-contained engine
  // (PivotMDS init → Barnes-Hut forces → guaranteed overlap removal) instead
  // of the old random-scatter + d3 burst, which stopped on alpha decay and
  // could settle — then persist — with overlapping cards. Cards are modelled
  // as their bounding circles, so "no circle overlap" implies "no card
  // overlap". The engine output is normalized to its viewport; divide the
  // reported scale back out to get world coordinates at true card size.
  const engineLayout = useMemo<Map<string, { x: number; y: number }> | null>(() => {
    if (serverSeed !== null || incrementalLayout !== null || layoutOverride !== null || contextData.nodes.length === 0) return null;
    const rectR = Math.hypot(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) / 2;
    const squareR = (CARD_DIMENSIONS.SQUARE_SIDE / 2) * Math.SQRT2; // circumscribed radius
    // 'hexagon' is rendered as a square (the hexagon look was retired), so it
    // takes the square collision radius.
    const radiusForShape = (shape: string) =>
      shape === 'square' || shape === 'hexagon' ? squareR : rectR;
    // With a revealed neighbourhood, cut the revealed cluster's tethers to the
    // folder/alias meta-nodes in the ENGINE's input only. Left attached, the
    // engine strings the neighbours out toward their type folders (a chain);
    // detached, the ego cluster is its own component and the degree-weighted
    // repulsion fans the neighbours around the focused node. The real edges
    // still draw — only the layout ignores them.
    const isMetaId = (id: string) => isFolderNodeId(id) || isAliasNodeId(id);
    let engineLinks = simLinks.map(l => ({ source: endpointId(l.source), target: endpointId(l.target) }));
    if (egoNodeId && contextData.nodes.some(n => String(n.id) === String(egoNodeId))) {
      const ego = String(egoNodeId);
      const egoSet = new Set<string>([ego]);
      engineLinks.forEach(l => {
        if (l.source === ego && !isMetaId(l.target)) egoSet.add(l.target);
        if (l.target === ego && !isMetaId(l.source)) egoSet.add(l.source);
      });
      engineLinks = engineLinks.filter(l => {
        const metaToEgo =
          (isMetaId(l.source) && egoSet.has(l.target)) ||
          (isMetaId(l.target) && egoSet.has(l.source));
        return !metaToEgo;
      });
    }
    const result = layoutContext(
      contextData.nodes.map(n => ({
        id: String(n.id),
        r: isFolderNodeId(String(n.id))
          ? folderRadius(folderCount(n))
          : isAliasNodeId(String(n.id))
            ? aliasRadius(folderCount(n))
            : isNoteNodeId(String(n.id))
              ? NOTE_NODE_RADIUS
              : radiusForShape(getNodeTypeConfig(n.type, nodeTypes).shape),
      })),
      engineLinks,
      {
        width: 2000,
        height: 1400,
        padding: 0,
        nodePadding: 72,
        // K-proportional default margin (~340px at card scale) reads as
        // excessive whitespace between small components — one card width is
        // plenty of separation.
        componentMargin: 150,
        timeBudgetMs: 1500,
        seed: `${contextDataHash}:0`,
      },
    );
    const inv = 1 / result.stats.scale;
    return new Map(
      result.nodes.map(p => [String(p.id), { x: (p.x - 1000) * inv, y: (p.y - 700) * inv }]),
    );
  }, [serverSeed, incrementalLayout, layoutOverride, contextData.nodes, simLinks, nodeTypes, contextDataHash, egoNodeId]);

  // The target layout for the current structure: a prescriptive override
  // (home ring) when given, else the engine's force-directed result.
  const finalLayout = layoutOverride ?? engineLayout;

  // In-session drags (savedPositionsRef) take precedence, then the
  // server-saved layout, then the freshly computed engine layout.
  const simNodes = useMemo<SimNode[]>(() => {
    const structureChanged = contextDataHash !== contextDataHashRef.current;
    if (structureChanged) {
      contextDataHashRef.current = contextDataHash;
      savedPositionsRef.current.clear();
    }

    const serverSeedPositions = serverSeed?.positions ?? null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return contextData.nodes.map((node, index) => {
      const savedPos =
        savedPositionsRef.current.get(node.id) ??
        seedPositions?.get(String(node.id)) ??
        serverSeedPositions?.[node.id] ??
        incrementalLayout?.get(String(node.id)) ??
        finalLayout?.get(String(node.id));
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
  }, [contextData.nodes, contextDataHash, serverSeed, seedPositions, incrementalLayout, finalLayout]);

  // Wrap the canvas's geometry callback to stamp it with the current
  // version-prefixed structure hash before handing it to the persistence layer,
  // remembering it session-side so a structure round-trip restores THIS layout
  // rather than the stale mount-time copy.
  const handlePersistLayout = useCallback((positions: Record<string, { x: number; y: number }>, transform: Transform) => {
    const layout: ContextLayoutData = { hash: layoutHash, transform, positions };
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
          {initialLayout ? 'Restoring layout…' : 'Loading context…'}
        </p>
      </div>
    );
  }

  // Empty state
  if (!error && contextData.nodes.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-600">No context data matches the current filters.</div>;
  }

  return (
    <div className="relative h-full w-full bg-white">
      {error && (
        <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-red-700">
          {error}
        </div>
      )}
      <div className="h-full w-full">
        <ContextCanvas
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
          // Clicking empty canvas clears the click-selection (the focus
          // highlight) and any revealed neighbourhood with it.
          onBackgroundClick={() => { setSelectedNode(null); onNodeSelect?.(null); }}
          onNodeHover={handleNodeHover}
          savedPositionsRef={savedPositionsRef}
          nodeTypes={nodeTypes}
          linkTypes={linkTypes}
          communityAliases={communityAliases}
          // A server restore, an incremental reuse, and a fresh engine layout
          // all arrive as final positions — freeze the simulation instead of
          // running a burst.
          coldStart={coldStart && incrementalLayout === null && finalLayout === null}
          initialTransform={serverSeed?.transform ?? null}
          // Transition: nodes start on the seeds and glide to the target
          // layout (home ring, or the engine's force-directed result).
          targetPositions={seedPositions && finalLayout ? finalLayout : null}
          // Fresh engine/incremental layouts (no saved camera) should be
          // persisted once the canvas has fitted them; a server restore
          // should not re-persist. A transition persists itself when the
          // glide completes.
          persistOnRestore={serverSeed === null && seedPositions === null && (incrementalLayout !== null || finalLayout !== null)}
          onPersistLayout={handlePersistLayout}
        />
      </div>
    </div>
  );
};

export default ContextWithTable;
