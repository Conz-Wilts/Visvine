'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import { NodeTypeConfig, CommunityAlias, LinkTypeConfig, getNodeTypeConfig, findAlias } from '@/lib/types';
import { CARD_DIMENSIONS, LOD_THRESHOLDS, OBSIDIAN_PHYSICS as P, type NodeLOD } from './utils/constants';
import { drawLinks, drawEdgeLabels, type PendingLabel } from './renderers/LinkRenderer';
import { drawRectangleNode, type CanvasTheme } from './renderers/RectangleNodeRenderer';
import { drawCircleNode } from './renderers/CircleNodeRenderer';
import { drawSquareNode } from './renderers/SquareNodeRenderer';
import { drawFolderNode, drawAliasNode, drawNoteNode } from './renderers/FolderNodeRenderer';
import { isFolderNodeId, isAliasNodeId, folderCount, folderRadius, aliasRadius } from '@/lib/context/folderView';
import { isNoteNodeId, NOTE_NODE_RADIUS } from '@/lib/context/brainView';
import { preloadImages, onImageLoad } from './utils/imageCache';
import { useLayoutPersistence } from './hooks/useLayoutPersistence';
import { prefersReducedMotion } from '@/lib/motion';

/* ============================================================================
   SHARED TYPES (re-exported for consumers)
   ============================================================================ */

export interface SimNode {
  id: string;
  name: string;
  type: string;
  image_url?: string | null;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  index?: number;
  spawnTime?: number;
  spawnIndex?: number;
  [key: string]: unknown;
}

export interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  relationship?: string;
  /** Aggregated edges (folder view) carry how many underlying links they stand for. */
  weight?: number;
  /** Quiet edges (brain view mentions) draw only while focus/hover lights them. */
  quiet?: boolean;
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

/* ============================================================================
   FORCE-DIRECTED CONTEXT CANVAS COMPONENT
   ============================================================================ */

// Pointer travel (in screen px) below which a press counts as a click, not a
// drag. Used both to start a drag and to fire onNodeClick — keep them in sync.
const DRAG_THRESHOLD = 5;

const endpointIdOf = (v: SimLink['source']): string =>
  typeof v === 'string' ? v : String((v as SimNode).id);

/**
 * Unweighted shortest path between two nodes — the "how are these two
 * connected" answer. BFS over an adjacency map built per call; at community
 * scale (hundreds of nodes) this is sub-millisecond, so it runs live while the
 * user moves the mouse with a node focused. Returns null when unreachable.
 */
function findShortestPath(
  links: SimLink[],
  fromId: string,
  toId: string,
): { nodeIds: Set<string>; links: Set<SimLink> } | null {
  if (fromId === toId) return null;
  const adjacency = new Map<string, Array<{ other: string; link: SimLink }>>();
  links.forEach(link => {
    const s = endpointIdOf(link.source);
    const t = endpointIdOf(link.target);
    if (!adjacency.has(s)) adjacency.set(s, []);
    if (!adjacency.has(t)) adjacency.set(t, []);
    adjacency.get(s)!.push({ other: t, link });
    adjacency.get(t)!.push({ other: s, link });
  });
  if (!adjacency.has(fromId) || !adjacency.has(toId)) return null;

  const parent = new Map<string, { prev: string; link: SimLink }>();
  const visited = new Set<string>([fromId]);
  const queue: string[] = [fromId];
  let found = false;
  while (queue.length > 0 && !found) {
    const id = queue.shift()!;
    for (const { other, link } of adjacency.get(id) ?? []) {
      if (visited.has(other)) continue;
      visited.add(other);
      parent.set(other, { prev: id, link });
      if (other === toId) { found = true; break; }
      queue.push(other);
    }
  }
  if (!found) return null;

  const nodeIds = new Set<string>([toId]);
  const pathLinks = new Set<SimLink>();
  let cursor = toId;
  while (cursor !== fromId) {
    const step = parent.get(cursor)!;
    pathLinks.add(step.link);
    nodeIds.add(step.prev);
    cursor = step.prev;
  }
  return { nodeIds, links: pathLinks };
}

const ContextCanvas: React.FC<{
  nodes: SimNode[];
  links: SimLink[];
  focusNodeId?: string | null;
  dimmedNodeIds?: Set<string>;
  autoZoomToFocus?: boolean;
  onNodeClick?: (node: SimNode) => void;
  onNodeHover?: (node: SimNode | null) => void;
  savedPositionsRef?: React.MutableRefObject<Map<string, { x: number; y: number }>>;
  nodeTypes?: NodeTypeConfig[];
  communityAliases?: CommunityAlias[];
  /** Community's relationship type registry — colours + labels + directedness
   *  for highlighted edges. Falls back to DEFAULT_LINK_TYPES when omitted. */
  linkTypes?: LinkTypeConfig[];
  /** When false, the incoming node positions are a final layout (server
   *  restore or precomputed engine result) — freeze the simulation and apply
   *  `initialTransform` (or auto-fit) instead of running a cold burst. */
  coldStart?: boolean;
  /** Structure-transition targets: nodes arrive seeded at their start
   *  positions and glide to these (the engine's force-directed,
   *  crossing-reduced layout), then the camera refits and the result
   *  persists. */
  targetPositions?: ReadonlyMap<string, { x: number; y: number }> | null;
  initialTransform?: Transform | null;
  /** Persist the frozen layout once after mounting it. Used for freshly
   *  precomputed layouts (which the server hasn't seen yet) — a plain server
   *  restore leaves this false so it isn't pointlessly written back. */
  persistOnRestore?: boolean;
  /** Called (debounced) when the layout settles, a node is dragged, or the user
   *  pans/zooms — so the parent can persist positions + camera transform. */
  onPersistLayout?: (positions: Record<string, { x: number; y: number }>, transform: Transform) => void;
  /** Right-click on a node — raises the node + cursor position so the parent can
   *  open a context menu (e.g. "Connect to…"). */
  onNodeContextMenu?: (node: SimNode, clientX: number, clientY: number) => void;
  /** Double-click on a node — e.g. open its detail page. */
  onNodeDoubleClick?: (node: SimNode) => void;
  /** Click (not a pan) on empty canvas background — lets the parent clear any
   *  current selection. */
  onBackgroundClick?: () => void;
}> = ({ nodes, links, focusNodeId, dimmedNodeIds, autoZoomToFocus = false, onNodeClick, onNodeHover, savedPositionsRef, nodeTypes, communityAliases, linkTypes, coldStart = true, targetPositions = null, initialTransform = null, persistOnRestore = false, onPersistLayout, onNodeContextMenu, onNodeDoubleClick, onBackgroundClick }) => {

  /* --------------------------------------------------------------------------
     STATE & REFS
     -------------------------------------------------------------------------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderScheduledRef = useRef<boolean>(false);
  // Tracks the last pointer position while panning the canvas.
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // Node currently being dragged (press on a node + travel past the click
  // threshold). While active the node is pinned to the cursor via fx/fy and
  // the simulation is reheated so its neighbours react.
  const dragNodeRef = useRef<SimNode | null>(null);
  const dragActiveRef = useRef(false);
  const hasInitialFitRef = useRef(false);
  const prevFocusNodeIdRef = useRef<string | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const mouseDownNodeRef = useRef<SimNode | null>(null);
  const prevAutoZoomFocusRef = useRef<string | null>(null);

  // D3 force simulation
  const simulationRef = useRef<d3Force.Simulation<SimNode, SimLink> | null>(null);
  const simRafRef = useRef<number | null>(null);
  const ticksRef = useRef(0);
  const fitToScreenRef = useRef<((animate?: boolean) => void) | null>(null);

  // Drives the staggered fade-in when a saved layout is restored (the frozen
  // simulation only renders one frame, so the fade needs its own render pump).
  const introRafRef = useRef<number | null>(null);
  // Resolved once on mount; honoured by the fade so reduced-motion users get an
  // instant, static context.
  const reduceMotionRef = useRef(prefersReducedMotion());

  // Layout persistence: cold/drag → persist on settle; restore → don't persist
  // back; pan/zoom → debounced. (See ./hooks/useLayoutPersistence.)
  const { markDirty, flushOnSettle, schedulePersist } = useLayoutPersistence(onPersistLayout);
  const coldStartRef = useRef(coldStart);
  coldStartRef.current = coldStart;
  const targetPositionsRef = useRef(targetPositions);
  targetPositionsRef.current = targetPositions;
  const initialTransformRef = useRef(initialTransform);
  initialTransformRef.current = initialTransform;
  const persistOnRestoreRef = useRef(persistOnRestore);
  persistOnRestoreRef.current = persistOnRestore;

  // Use refs for values that change frequently during interactions to avoid React re-renders
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  // Lower bound for wheel zoom-out. Defaults to a far-out floor but is widened by
  // fitToScreen so the user can always zoom back out to (and a touch beyond) the
  // initial "whole context" overview — on large contexts / small screens that fit
  // zoom can be smaller than the static floor, which otherwise traps the camera
  // zoomed-in with no way back to the starting view.
  const minZoomRef = useRef(0.05);
  const isPanningRef = useRef(false);

  // Refs to stabilize render callback - these are synced from props before rendering
  const focusNodeIdRef = useRef<string | null>(null);
  const dimmedNodeIdsRef = useRef<Set<string>>(new Set());
  // Node currently under the pointer. A ref (not state) so hover highlighting
  // repaints without a React render — it changes on every mousemove.
  const hoveredNodeIdRef = useRef<string | null>(null);

  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const isLayoutReadyRef = useRef(false);
  const [, setIsInitialFitComplete] = useState(false);
  const [cursorStyle, setCursorStyle] = useState<'grab' | 'grabbing' | 'move' | 'pointer'>('grab');

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */

  const screenToContext = useCallback((screenX: number, screenY: number) => {
    const transform = transformRef.current;
    return {
      x: (screenX - transform.x) / transform.k,
      y: (screenY - transform.y) / transform.k
    };
  }, []);

  const findNodeAt = useCallback((screenX: number, screenY: number) => {
    const contextPos = screenToContext(screenX, screenY);
    return nodes.find(node => {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') return false;

      if (isFolderNodeId(String(node.id))) {
        const r = folderRadius(folderCount(node));
        return Math.hypot(contextPos.x - node.x, contextPos.y - node.y) <= r;
      }
      if (isAliasNodeId(String(node.id))) {
        const r = aliasRadius(folderCount(node));
        return Math.hypot(contextPos.x - node.x, contextPos.y - node.y) <= r;
      }
      if (isNoteNodeId(String(node.id))) {
        return Math.hypot(contextPos.x - node.x, contextPos.y - node.y) <= NOTE_NODE_RADIUS;
      }
      const shape = getNodeTypeConfig(node.type, nodeTypes).shape;

      if (shape === 'square' || shape === 'hexagon') {
        // Image-forward card: SQUARE_SIDE wide × SQUARE_SIDE + SQUARE_CAPTION tall.
        const halfW = CARD_DIMENSIONS.SQUARE_SIDE / 2;
        const halfH = (CARD_DIMENSIONS.SQUARE_SIDE + CARD_DIMENSIONS.SQUARE_CAPTION) / 2;
        return (
          contextPos.x >= node.x - halfW &&
          contextPos.x <= node.x + halfW &&
          contextPos.y >= node.y - halfH &&
          contextPos.y <= node.y + halfH
        );
      } else {
        const halfWidth = CARD_DIMENSIONS.WIDTH / 2;
        const halfHeight = CARD_DIMENSIONS.HEIGHT / 2;
        return (
          contextPos.x >= node.x - halfWidth &&
          contextPos.x <= node.x + halfWidth &&
          contextPos.y >= node.y - halfHeight &&
          contextPos.y <= node.y + halfHeight
        );
      }
    });
  }, [nodes, nodeTypes, screenToContext]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!onNodeContextMenu) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const node = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (node) {
      e.preventDefault(); // only suppress the browser menu when we hit a node
      onNodeContextMenu(node, e.clientX, e.clientY);
    }
  }, [onNodeContextMenu, findNodeAt]);

  /* --------------------------------------------------------------------------
     RENDERING
     -------------------------------------------------------------------------- */

  const getCanvasTheme = useCallback((): CanvasTheme => {
    const style = getComputedStyle(document.documentElement);
    const get = (v: string, fallback: string) => style.getPropertyValue(v).trim() || fallback;
    return {
      cardBg:         get('--surface-1', '#ffffff'),
      textPrimary:    get('--text-primary', '#111827'),
      textSecondary:  get('--text-secondary', '#6b7280'),
      placeholderStart: get('--surface-3', '#e5e7eb'),
      placeholderEnd:   get('--surface-2', '#f3f4f6'),
    };
  }, []);

  const drawNodeCard = useCallback((
    ctx: CanvasRenderingContext2D,
    node: SimNode,
    lod: NodeLOD,
    isFocused: boolean,
    isConnected: boolean,
    shouldDim: boolean,
    theme: CanvasTheme
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

    const typeConfig = getNodeTypeConfig(node.type, nodeTypes);
    // Alias colour overrides base type colour, matching how the directory card
    // resolves colour. Without this, Founder/Investor/Government nodes in the
    // context view fall back to the base type colour and lose their distinction.
    const nodeAlias = (node as { alias?: string | null }).alias;
    const aliasConfig = findAlias(communityAliases, nodeAlias, node.type);
    const borderColor = aliasConfig?.color ?? typeConfig.color;
    const shape = typeConfig.shape;

    if (isFolderNodeId(String(node.id))) {
      drawFolderNode(ctx, node, node.x, node.y, isFocused, shouldDim, borderColor, theme);
      return;
    }
    if (isAliasNodeId(String(node.id))) {
      drawAliasNode(ctx, node, node.x, node.y, isFocused, shouldDim, borderColor, theme);
      return;
    }
    if (isNoteNodeId(String(node.id))) {
      drawNoteNode(ctx, node, node.x, node.y, isFocused, shouldDim, borderColor, theme);
      return;
    }

    const borderWidth = isFocused ? CARD_DIMENSIONS.BORDER_WIDTH * 1.6 : CARD_DIMENSIONS.BORDER_WIDTH;

    // 'hexagon' is treated as 'square': the hexagon look was retired in favour of
    // a rounded square (matching the community avatar). Existing data still stored
    // with shape:'hexagon' therefore renders as a square without a DB migration.
    if (shape === 'square' || shape === 'hexagon') {
      drawSquareNode(ctx, node, node.x, node.y, lod, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    } else if (shape === 'circle') {
      drawCircleNode(ctx, node, node.x, node.y, lod, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    } else {
      drawRectangleNode(ctx, node, node.x, node.y, lod, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    }
  }, [nodeTypes, communityAliases]);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const transform = transformRef.current;
    const currentFocusNodeId = focusNodeIdRef.current;
    const currentDimmedNodeIds = dimmedNodeIdsRef.current;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas;

    ctx.clearRect(0, 0, width, height);

    // Suppress draws until the initial fitToScreen has placed the camera; otherwise
    // links flash at the canvas top-left while the simulation is still seeded near origin.
    if (!hasInitialFitRef.current) {
      return;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Viewport culling bounds (in context coordinates)
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;
    const viewLeft = -transform.x / transform.k;
    const viewTop = -transform.y / transform.k;
    const viewRight = (cssWidth - transform.x) / transform.k;
    const viewBottom = (cssHeight - transform.y) / transform.k;
    const cullPad = Math.max(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) * 1.5;

    // Zoom-based level of detail: full cards only when zoomed in enough to
    // read them; flat silhouettes when zoomed far out. Keeps pan/zoom cheap on
    // large communities and defers image fetches until the user actually zooms
    // in on a card.
    const lod: NodeLOD =
      transform.k >= LOD_THRESHOLDS.FULL_MIN_K ? 'full'
      : transform.k >= LOD_THRESHOLDS.MID_MIN_K ? 'mid'
      : 'low';

    // Resolve the CSS theme once per frame, not once per node — getComputedStyle
    // per card per frame was a measurable chunk of the draw loop.
    const theme = getCanvasTheme();

    // Neighbour sets for the focused and hovered nodes drive the highlight
    // modes below. Both are cheap O(L) sweeps per frame.
    const neighborsOf = (centerId: string): Set<string> => {
      const out = new Set<string>();
      links.forEach(link => {
        const sourceId = endpointIdOf(link.source);
        const targetId = endpointIdOf(link.target);
        if (sourceId === centerId) out.add(targetId);
        else if (targetId === centerId) out.add(sourceId);
      });
      return out;
    };

    const focusId = currentFocusNodeId != null ? String(currentFocusNodeId) : null;
    const focusNodeExists = focusId != null && nodes.some(n => String(n.id) === focusId);
    const connectedToFocus = focusNodeExists ? neighborsOf(focusId!) : new Set<string>();

    const hoveredId = hoveredNodeIdRef.current;
    const hoverNodeExists = hoveredId != null && nodes.some(n => String(n.id) === hoveredId);
    const connectedToHover = hoverNodeExists ? neighborsOf(hoveredId!) : new Set<string>();

    // With a node focused, hovering any other node lights the shortest path
    // between them — the "how are these two connected" answer, live under the
    // mouse. Direct neighbours produce a one-hop path, which reads naturally.
    const path = focusNodeExists && hoverNodeExists && hoveredId !== focusId
      ? findShortestPath(links, focusId!, hoveredId!)
      : null;

    const renderNow = performance.now();

    // Draw Links
    const allNodesDimmed = nodes.length > 0 && nodes.every(n => currentDimmedNodeIds.has(String(n.id)));
    const shouldDrawLinks = (!currentFocusNodeId && !allNodesDimmed) || focusNodeExists || hoverNodeExists;

    let pendingLabels: PendingLabel[] = [];
    if (shouldDrawLinks) {
      pendingLabels = drawLinks(
        ctx, links, nodes, transform,
        {
          focusNodeId: focusNodeExists ? focusId : null,
          hoveredNodeId: hoverNodeExists ? hoveredId : null,
          pathLinks: path?.links ?? null,
        },
        linkTypes,
        renderNow, reduceMotionRef.current,
        { left: viewLeft, top: viewTop, right: viewRight, bottom: viewBottom },
        nodeTypes,
      );
    }

    // Draw Nodes with viewport culling
    nodes.forEach(node => {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

      if (
        node.x < viewLeft - cullPad || node.x > viewRight + cullPad ||
        node.y < viewTop - cullPad || node.y > viewBottom + cullPad
      ) return;

      const id = String(node.id);
      const isFocused = focusNodeExists && id === focusId;
      const isHovered = hoverNodeExists && id === hoveredId;
      const isInDimmedSet = currentDimmedNodeIds?.has(id) ?? false;

      // Four highlight modes, most specific first:
      // path lit → only the route stays bright; focus → node + neighbours;
      // hover → node + neighbours, softer dim; rest → search dimming only.
      let isConnected: boolean;
      let shouldDim: boolean;
      let dimAlpha = 0.15;
      if (path) {
        const onPath = path.nodeIds.has(id);
        isConnected = onPath && !isFocused && !isHovered;
        shouldDim = !onPath;
        dimAlpha = 0.1;
      } else if (focusNodeExists) {
        isConnected = connectedToFocus.has(id);
        shouldDim = !isFocused && !isConnected && !isHovered;
      } else if (hoverNodeExists) {
        isConnected = connectedToHover.has(id);
        shouldDim = !isHovered && !isConnected;
        // Hover is a glance, not a mode — dim gently so it feels like the
        // neighbourhood glows rather than the community disappearing.
        dimAlpha = isInDimmedSet ? 0.15 : 0.4;
      } else {
        isConnected = false;
        shouldDim = isInDimmedSet;
      }

      const stagger = (node.spawnIndex ?? 0) * P.fadeInStaggerMs;
      const elapsed = renderNow - (node.spawnTime ?? renderNow) - stagger;
      const fadeAlpha = reduceMotionRef.current
        ? 1
        : Math.max(0, Math.min(1, elapsed / P.fadeInDurationMs));

      ctx.save();
      ctx.globalAlpha = (shouldDim ? dimAlpha : 1) * fadeAlpha;
      // Ease each node up into place as it fades in. Purely a draw-time offset —
      // node.x/node.y (and the persisted layout) are never touched.
      const rise = (1 - fadeAlpha) * P.fadeInRiseY;
      if (rise) ctx.translate(0, rise);
      drawNodeCard(ctx, node, lod, isFocused || isHovered, isConnected, shouldDim, theme);
      ctx.restore();
    });

    // Relationship pills draw last so a card never hides them.
    drawEdgeLabels(ctx, pendingLabels, transform);

    ctx.restore();
  }, [nodes, links, linkTypes, nodeTypes, drawNodeCard, getCanvasTheme]);

  const scheduleRender = useCallback(() => {
    if (!renderScheduledRef.current) {
      renderScheduledRef.current = true;
      requestAnimationFrame(() => {
        renderScheduledRef.current = false;
        render();
      });
    }
  }, [render]);

  const updateTransform = useCallback((update: Partial<Transform> | ((prev: Transform) => Transform)) => {
    if (typeof update === 'function') {
      transformRef.current = update(transformRef.current);
    } else {
      transformRef.current = { ...transformRef.current, ...update };
    }
    scheduleRender();
  }, [scheduleRender]);

  /* --------------------------------------------------------------------------
     LAYOUT PERSISTENCE
     -------------------------------------------------------------------------- */

  const collectPositions = useCallback((): Record<string, { x: number; y: number }> => {
    const positions: Record<string, { x: number; y: number }> = {};
    const source = simulationRef.current?.nodes() ?? nodes;
    source.forEach(node => {
      if (typeof node.x === 'number' && typeof node.y === 'number') {
        positions[node.id] = { x: node.x, y: node.y };
      }
    });
    return positions;
  }, [nodes]);

  /* --------------------------------------------------------------------------
     FORCE SIMULATION — live, RAF-driven
     -------------------------------------------------------------------------- */

  const startSimLoop = useCallback(() => {
    if (simRafRef.current !== null) {
      cancelAnimationFrame(simRafRef.current);
      simRafRef.current = null;
    }

    const loop = () => {
      const sim = simulationRef.current;
      if (!sim) return;

      sim.tick();
      ticksRef.current += 1;

      // First mount of a new context: keep canvas blank for the first few ticks
      // so the camera is correct before the burst becomes visible. After the
      // initial fit, render every tick (sim relax during drag also lands here).
      if (hasInitialFitRef.current) {
        scheduleRender();
      } else if (
        ticksRef.current === P.ticksBeforeReveal &&
        fitToScreenRef.current
      ) {
        fitToScreenRef.current(false);
      } else if (ticksRef.current > P.ticksBeforeReveal) {
        scheduleRender();
      }

      if (sim.alpha() > sim.alphaMin()) {
        simRafRef.current = requestAnimationFrame(loop);
      } else {
        simRafRef.current = null;
        // collectPositions falls back to sim.nodes(), so at settle time this map
        // is identical to the inline scrape it replaces.
        const positions = collectPositions();
        Object.entries(positions).forEach(([id, p]) => savedPositionsRef?.current.set(id, p));
        isLayoutReadyRef.current = true;
        setIsLayoutReady(true);
        // Persist a freshly computed (or just-dragged) layout, but never a frozen restore.
        flushOnSettle(positions, transformRef.current);
      }
    };

    simRafRef.current = requestAnimationFrame(loop);
  }, [scheduleRender, savedPositionsRef, flushOnSettle, collectPositions]);

  // Pump renders for the duration of the staggered fade-in. Used when a saved
  // layout is restored: the simulation is frozen (alpha 0) and would otherwise
  // render a single frame, freezing the fade mid-way. Moves nothing — positions
  // stay exactly on the restored layout.
  const playFadeIn = useCallback((startNow: number, totalStaggerMs: number) => {
    if (introRafRef.current !== null) cancelAnimationFrame(introRafRef.current);
    const total = P.fadeInDurationMs + totalStaggerMs + 50;
    const frame = (now: number) => {
      scheduleRender();
      if (now - startNow < total) {
        introRafRef.current = requestAnimationFrame(frame);
      } else {
        introRafRef.current = null;
        scheduleRender();
      }
    };
    introRafRef.current = requestAnimationFrame(frame);
  }, [scheduleRender]);

  // Initialise / reinitialise simulation when nodes or links change
  useEffect(() => {
    if (nodes.length === 0) {
      isLayoutReadyRef.current = false;
      setIsLayoutReady(false);
      setIsInitialFitComplete(false);
      simulationRef.current?.stop();
      simulationRef.current = null;
      if (simRafRef.current !== null) {
        cancelAnimationFrame(simRafRef.current);
        simRafRef.current = null;
      }
      return;
    }

    setIsLayoutReady(false);
    setIsInitialFitComplete(false);
    // The node objects are replaced on a structure change — drop any drag in
    // progress so a stale reference can't pin a discarded node.
    dragNodeRef.current = null;
    dragActiveRef.current = false;
    // A transition glide keeps the current camera (draws must not be
    // suppressed mid-animation), so remember whether it was ever fitted.
    const wasFitted = hasInitialFitRef.current;
    hasInitialFitRef.current = false;
    ticksRef.current = 0;

    if (simRafRef.current !== null) {
      cancelAnimationFrame(simRafRef.current);
      simRafRef.current = null;
    }
    simulationRef.current?.stop();

    // d3-force's forceLink mutates each link.source/target from an id-string into
    // a node-object reference and never re-resolves an endpoint that is already an
    // object (see d3-force/src/link.js initialize()). On a re-layout the nodes array
    // is regenerated but the links array is reused, so its endpoints still point at
    // the old (now discarded) node objects whose positions are frozen — links would
    // render fixed while the new nodes move. Reset endpoints back to ids here so d3
    // re-binds them against the current node objects.
    links.forEach(link => {
      if (link.source && typeof link.source === 'object') link.source = String((link.source as SimNode).id);
      if (link.target && typeof link.target === 'object') link.target = String((link.target as SimNode).id);
    });

    // Pre-compute connected node set so isolated nodes get pushed to a periphery ring.
    const connectedIds = new Set<string>();
    links.forEach(link => {
      const src = String(typeof link.source === 'string' ? link.source : (link.source as SimNode).id);
      const tgt = String(typeof link.target === 'string' ? link.target : (link.target as SimNode).id);
      connectedIds.add(src);
      connectedIds.add(tgt);
    });

    // Per-node collision footprint: folders, alias circles, the home card and
    // entity cards each reserve their real drawn size (cards by circumscribed
    // circle, so no corner can peek under a neighbour) plus breathing room.
    const collideRadiusFor = (n: SimNode): number => {
      const id = String(n.id);
      if (isFolderNodeId(id)) return folderRadius(folderCount(n)) + 40;
      if (isAliasNodeId(id)) return aliasRadius(folderCount(n)) + 18;
      const shape = getNodeTypeConfig(n.type, nodeTypes).shape;
      return shape === 'square' || shape === 'hexagon'
        ? (CARD_DIMENSIONS.SQUARE_SIDE / 2) * Math.SQRT2 + 56
        : Math.hypot(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) / 2 + 56;
    };

    // Meta edges sit closer than the card default so structures hug their
    // hubs: alias circles ring their folder tightly, folders orbit home.
    const linkDistanceFor = (link: SimLink): number => {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      const sId = String(s.id);
      const tId = String(t.id);
      if (isAliasNodeId(sId) || isAliasNodeId(tId)) {
        return collideRadiusFor(s) + collideRadiusFor(t) + 60;
      }
      if (isFolderNodeId(sId) || isFolderNodeId(tId)) {
        return collideRadiusFor(s) + collideRadiusFor(t) + 340;
      }
      return P.linkDistance;
    };

    // Obsidian-tuned simulation. centerStrength maps to forceX/forceY (soft pull
    // toward origin), repelStrength to forceManyBody, linkStrength + linkDistance
    // to forceLink — same shape as the Obsidian Forces panel, scaled for card geometry.
    const sim = d3Force
      .forceSimulation<SimNode>(nodes)
      .alpha(P.alpha)
      .alphaDecay(P.alphaDecay)
      .alphaMin(P.alphaMin)
      .velocityDecay(P.velocityDecay)
      .force('link',
        d3Force.forceLink<SimNode, SimLink>(links)
          .id(d => String(d.id))
          .distance(linkDistanceFor)
          .strength(P.linkStrength)
      )
      .force('charge',
        d3Force.forceManyBody<SimNode>()
          .strength(P.chargeStrength)
          .distanceMin(P.chargeDistanceMin)
          .distanceMax(P.chargeDistanceMax)
      )
      .force('x', d3Force.forceX<SimNode>(0).strength(P.centerStrength))
      .force('y', d3Force.forceY<SimNode>(0).strength(P.centerStrength))
      .force('collide',
        d3Force.forceCollide<SimNode>()
          .radius(collideRadiusFor)
          .strength(1)
          .iterations(3)
      )
      .force('isolatedRing',
        d3Force.forceRadial<SimNode>(
          d => connectedIds.has(String(d.id)) ? 0 : P.linkDistance * P.isolatedRingMultiplier,
          0, 0
        ).strength(d => connectedIds.has(String(d.id)) ? 0 : P.isolatedRingStrength)
      )
      .stop();

    simulationRef.current = sim;

    // Stamp a fresh fade-in window so nodes cascade in from when the canvas
    // actually mounts — not from when the parent first built the node list, which
    // may have been seconds earlier behind a loading spinner (which would leave
    // the fade already elapsed, popping the context in flat).
    const introStart = typeof performance !== 'undefined' ? performance.now() : 0;
    // Compress the per-node stagger so the whole cascade fits inside the cap —
    // otherwise large communities spend `count × staggerMs` (many seconds)
    // continuously redrawing the full canvas. spawnIndex is fractional: the
    // renderers multiply it by fadeInStaggerMs, so scaling it here scales the
    // whole window.
    const staggerScale = Math.min(1, P.fadeInMaxTotalStaggerMs / Math.max(1, nodes.length * P.fadeInStaggerMs));
    nodes.forEach((node, i) => { node.spawnTime = introStart; node.spawnIndex = i * staggerScale; });
    const totalStaggerMs = nodes.length * P.fadeInStaggerMs * staggerScale;

    let fitRaf: number | null = null;
    const glideTargets = targetPositionsRef.current;
    if (coldStartRef.current === false && glideTargets && wasFitted) {
      // Structure transition: the nodes arrived seeded at their start
      // positions; glide them to the engine's force-directed,
      // crossing-reduced layout, then refit the camera and persist. The
      // glide itself is the animation — no fade re-cascade on top of it.
      sim.alpha(0);
      hasInitialFitRef.current = true;
      setIsInitialFitComplete(true);
      isLayoutReadyRef.current = true;
      setIsLayoutReady(true);
      nodes.forEach(node => {
        node.spawnTime = introStart - P.fadeInDurationMs - 1000;
        node.spawnIndex = 0;
      });

      const finishGlide = () => {
        const positions = collectPositions();
        Object.entries(positions).forEach(([id, p]) => savedPositionsRef?.current.set(id, p));
        fitToScreenRef.current?.(!reduceMotionRef.current);
        markDirty();
        flushOnSettle(positions, transformRef.current);
      };

      if (reduceMotionRef.current) {
        nodes.forEach(node => {
          const target = glideTargets.get(String(node.id));
          if (target) { node.x = target.x; node.y = target.y; }
        });
        scheduleRender();
        finishGlide();
      } else {
        const starts = new Map(nodes.map(n => [String(n.id), { x: n.x ?? 0, y: n.y ?? 0 }]));
        const GLIDE_MS = 700;
        const frame = (now: number) => {
          const progress = Math.min(1, (now - introStart) / GLIDE_MS);
          const eased = 1 - Math.pow(1 - progress, 3);
          nodes.forEach(node => {
            const start = starts.get(String(node.id));
            const target = glideTargets.get(String(node.id));
            if (!start || !target) return;
            node.x = start.x + (target.x - start.x) * eased;
            node.y = start.y + (target.y - start.y) * eased;
          });
          scheduleRender();
          if (progress < 1) {
            introRafRef.current = requestAnimationFrame(frame);
          } else {
            introRafRef.current = null;
            finishGlide();
          }
        };
        introRafRef.current = requestAnimationFrame(frame);
      }
    } else if (coldStartRef.current === false) {
      // Final layout (server restore or precomputed engine result): freeze the
      // simulation so the seeded positions stay put.
      sim.alpha(0);
      if (initialTransformRef.current) {
        // Server restore: apply the saved camera instead of auto-fitting.
        transformRef.current = { ...initialTransformRef.current };
        hasInitialFitRef.current = true;
        setIsInitialFitComplete(true);
      } else {
        // Fresh engine layout: no saved camera — fit it once the canvas has
        // been sized (rAF runs after all mount effects), then persist the
        // layout+camera so future visits restore instead of recomputing.
        fitRaf = requestAnimationFrame(() => {
          fitRaf = null;
          fitToScreenRef.current?.(false);
          if (persistOnRestoreRef.current) {
            markDirty();
            flushOnSettle(collectPositions(), transformRef.current);
          }
        });
      }
      isLayoutReadyRef.current = true;
      setIsLayoutReady(true);
      // The frozen sim won't tick, so drive the staggered fade-in ourselves —
      // nodes rise + fade into their restored positions one by one.
      if (reduceMotionRef.current) {
        scheduleRender();
      } else {
        playFadeIn(introStart, totalStaggerMs);
      }
    } else {
      // Cold run: the live simulation renders every tick, so the fade rides along
      // with the burst. Persist the computed layout once it settles.
      markDirty();
      startSimLoop();
    }

    return () => {
      sim.stop();
      if (simRafRef.current !== null) {
        cancelAnimationFrame(simRafRef.current);
        simRafRef.current = null;
      }
      if (introRafRef.current !== null) {
        cancelAnimationFrame(introRafRef.current);
        introRafRef.current = null;
      }
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
    };
  }, [nodes, links, nodeTypes, startSimLoop, markDirty, flushOnSettle, collectPositions, playFadeIn, scheduleRender, savedPositionsRef]);

  // Repaint (RAF-deduped) whenever an image the renderers requested on demand
  // finishes loading — at mid/full zoom cards draw a placeholder first and this
  // swaps the real photo in as it arrives.
  useEffect(() => onImageLoad(scheduleRender), [scheduleRender]);

  // Warm the image cache a few at a time, but only once the browser is idle —
  // on large communities eagerly fetching hundreds of photos at mount competes
  // with the context payload and first paint. Zoomed-out views don't need photos
  // at all (low-LOD cards don't draw them); anything visible at readable zoom
  // loads immediately via loadImage() during draw.
  useEffect(() => {
    const imageUrls = nodes
      .map(node => node.image_url)
      .filter((url): url is string => !!url);

    if (imageUrls.length === 0) return;

    let cancelled = false;
    const CHUNK_SIZE = 8;
    const run = async () => {
      for (let i = 0; i < imageUrls.length; i += CHUNK_SIZE) {
        if (cancelled) return;
        await preloadImages(imageUrls.slice(i, i + CHUNK_SIZE));
      }
    };

    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    let idleId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    if (typeof w.requestIdleCallback === 'function') {
      idleId = w.requestIdleCallback(() => { void run(); }, { timeout: 4000 });
    } else {
      timerId = setTimeout(() => { void run(); }, 2500);
    }

    return () => {
      cancelled = true;
      if (idleId !== null) w.cancelIdleCallback?.(idleId);
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [nodes]);

  /* --------------------------------------------------------------------------
     EVENT HANDLERS
     -------------------------------------------------------------------------- */

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return; // right/middle press is for the context menu, not panning
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = findNodeAt(x, y);

    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    mouseDownNodeRef.current = node || null;

    if (node) {
      // Press on a node: within DRAG_THRESHOLD it's a click; past it the node
      // itself is dragged (live physics — see handleMouseMove).
      dragNodeRef.current = node;
      isPanningRef.current = false;
    } else {
      // Press on empty canvas pans.
      isPanningRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
    setCursorStyle('grabbing');
  }, [findNodeAt]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Node drag: pin the node to the cursor and reheat the simulation so its
    // neighbours pull along and the rest shuffles out of the way.
    if (dragNodeRef.current && mouseDownPosRef.current) {
      const rect = canvas.getBoundingClientRect();
      if (!dragActiveRef.current) {
        const dx = e.clientX - mouseDownPosRef.current.x;
        const dy = e.clientY - mouseDownPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return; // still a click
        dragActiveRef.current = true;
        markDirty();
        const sim = simulationRef.current;
        if (sim) {
          // Warm, not hot: neighbours pull along springily without the whole
          // graph re-forming under the cursor.
          sim.alphaTarget(0.18);
          if (simRafRef.current === null) startSimLoop();
        }
      }
      const p = screenToContext(e.clientX - rect.left, e.clientY - rect.top);
      const node = dragNodeRef.current;
      node.fx = p.x;
      node.fy = p.y;
      node.x = p.x;
      node.y = p.y;
      scheduleRender();
      return;
    }

    if (isPanningRef.current && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      updateTransform(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));
      if (isLayoutReadyRef.current) schedulePersist(collectPositions, () => transformRef.current);

      dragStartRef.current = { x: e.clientX, y: e.clientY };
    } else {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = findNodeAt(x, y);

      const hoveredId = node ? String(node.id) : null;
      if (hoveredId !== hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = hoveredId;
        scheduleRender();
      }

      if (node) {
        setCursorStyle('pointer');
        onNodeHover?.(node);
      } else {
        setCursorStyle('grab');
        onNodeHover?.(null);
      }
    }
  }, [updateTransform, findNodeAt, onNodeHover, schedulePersist, collectPositions, scheduleRender, markDirty, startSimLoop, screenToContext]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Release a node drag: unpin and let the simulation cool to a settle
    // (which persists the moved layout).
    if (dragActiveRef.current) {
      const node = dragNodeRef.current;
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      simulationRef.current?.alphaTarget(0);
      dragActiveRef.current = false;
      dragNodeRef.current = null;
      isPanningRef.current = false;
      dragStartRef.current = null;
      mouseDownPosRef.current = null;
      mouseDownNodeRef.current = null;
      setCursorStyle(node ? 'pointer' : 'grab');
      return;
    }
    dragNodeRef.current = null;

    if (mouseDownPosRef.current && mouseDownNodeRef.current && onNodeClick) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < DRAG_THRESHOLD) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const node = findNodeAt(x, y);

        if (node && node.id === mouseDownNodeRef.current.id) {
          onNodeClick(node);
        }
      }
    }

    // A click (not a pan) that started on empty canvas clears the selection.
    // The press began on the background (no mouse-down node) and the pointer
    // barely moved, so it isn't a pan.
    if (onBackgroundClick && mouseDownPosRef.current && !mouseDownNodeRef.current) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) {
        onBackgroundClick();
      }
    }

    isPanningRef.current = false;
    dragStartRef.current = null;
    mouseDownPosRef.current = null;
    mouseDownNodeRef.current = null;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = findNodeAt(x, y);
    setCursorStyle(node ? 'pointer' : 'grab');
  }, [onNodeClick, onBackgroundClick, findNodeAt]);

  // Leaving the canvas ends any pan (same as mouse-up) and clears the hover
  // highlight, which would otherwise stay lit on whatever was last under the
  // pointer.
  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    handleMouseUp(e);
    if (hoveredNodeIdRef.current !== null) {
      hoveredNodeIdRef.current = null;
      scheduleRender();
    }
    onNodeHover?.(null);
  }, [handleMouseUp, scheduleRender, onNodeHover]);

  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onNodeDoubleClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const node = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (node) onNodeDoubleClick(node);
  }, [onNodeDoubleClick, findNodeAt]);

  /* --------------------------------------------------------------------------
     EFFECTS - INITIALIZATION & UPDATES
     -------------------------------------------------------------------------- */

  // Sync props to refs and trigger render when they actually change
  useEffect(() => {
    const prevFocusNodeId = focusNodeIdRef.current;
    const prevDimmedNodeIds = dimmedNodeIdsRef.current;
    const currentFocusNodeId = focusNodeId ?? null;
    const currentDimmedNodeIds = dimmedNodeIds ?? new Set<string>();

    const setsAreEqual = (setA: Set<string>, setB: Set<string>): boolean => {
      if (setA.size !== setB.size) return false;
      for (const item of setA) {
        if (!setB.has(item)) return false;
      }
      return true;
    };

    const focusChanged = prevFocusNodeId !== currentFocusNodeId;
    const dimmedChanged = !setsAreEqual(prevDimmedNodeIds, currentDimmedNodeIds);

    if (focusChanged || dimmedChanged) {
      focusNodeIdRef.current = currentFocusNodeId;
      dimmedNodeIdsRef.current = currentDimmedNodeIds;
      scheduleRender();
    }
  }, [focusNodeId, dimmedNodeIds, scheduleRender]);

  // Eased (cubic-out) tween of the camera transform toward `target` over
  // `duration` ms, scheduling a render each frame. Shared by fitToScreen's
  // animate branch and the auto-zoom-to-focus effect (previously byte-identical).
  const animateTransform = useCallback((target: Transform, duration: number = 600) => {
    const startTransform = { ...transformRef.current };
    const startTime = performance.now();
    const animateFrame = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      transformRef.current = {
        x: startTransform.x + (target.x - startTransform.x) * eased,
        y: startTransform.y + (target.y - startTransform.y) * eased,
        k: startTransform.k + (target.k - startTransform.k) * eased
      };
      scheduleRender();
      if (progress < 1) requestAnimationFrame(animateFrame);
    };
    requestAnimationFrame(animateFrame);
  }, [scheduleRender]);

  // Zoom level (and centre) at which the whole current context fits the canvas.
  // Shared by fitToScreen and the wheel zoom-out clamp so the "how far out can I
  // go" floor always reflects the context's *current* bounding box, even when the
  // camera was restored from a saved layout and fitToScreen never ran.
  const computeFitView = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return null;

    const nodePositions = nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
    if (nodePositions.length === 0) return null;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodePositions.forEach(node => {
      if (typeof node.x === 'number' && typeof node.y === 'number') {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
      }
    });

    const padding = 200;
    const contextWidth = maxX - minX + padding * 2;
    const contextHeight = maxY - minY + padding * 2;
    const contextCenterX = (minX + maxX) / 2;
    const contextCenterY = (minY + maxY) / 2;

    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return null;

    const scaleX = width / contextWidth;
    const scaleY = height / contextHeight;
    const fitZoom = Math.min(scaleX, scaleY);
    return { fitZoom, contextCenterX, contextCenterY, width, height };
  }, [nodes]);

  // Wheel zoom-out floor: allow zooming out to a touch past the whole-context
  // overview (never trap the camera closer in than the context fits), but never
  // hard-stop before the static 0.05 far-out floor either.
  const minZoomFor = useCallback((fitZoom: number) => Math.min(0.05, fitZoom * 0.8), []);

  const fitToScreen = useCallback((animate: boolean = false) => {
    const fit = computeFitView();
    if (!fit) return;
    const { fitZoom, contextCenterX, contextCenterY, width, height } = fit;

    const targetZoom = Math.min(fitZoom, 1.2);
    minZoomRef.current = minZoomFor(fitZoom);
    const targetX = width / 2 - contextCenterX * targetZoom;
    const targetY = height / 2 - contextCenterY * targetZoom;

    if (!animate) {
      transformRef.current = { x: targetX, y: targetY, k: targetZoom };
      scheduleRender();
      hasInitialFitRef.current = true;
      setIsInitialFitComplete(true);
      return;
    }

    animateTransform({ x: targetX, y: targetY, k: targetZoom });
  }, [computeFitView, minZoomFor, scheduleRender, animateTransform]);

  // Keep fitToScreenRef pointing at the latest fitToScreen so startSimLoop
  // (defined earlier) can call it without a circular useCallback dependency.
  useEffect(() => {
    fitToScreenRef.current = fitToScreen;
  }, [fitToScreen]);

  // Canvas resize with high-DPI support
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Refit only on REAL resizes, not the initial measurement — refitting on
    // mount silently threw away the camera transform restored from the saved
    // layout, so the context always reopened at the fitted overview instead of
    // where the user left it.
    let prevWidth = 0;
    let prevHeight = 0;

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      scheduleRender();

      const sizeChanged = prevWidth !== 0 && (width !== prevWidth || height !== prevHeight);
      prevWidth = width;
      prevHeight = height;

      if (sizeChanged && isLayoutReadyRef.current) {
        hasInitialFitRef.current = false;
        fitToScreen(false);
      }
    };

    updateCanvasSize();
    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [scheduleRender, fitToScreen]);

  // Prevent browser zoom with native wheel event listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = -e.deltaY * 0.005;
      const factor = Math.exp(delta);

      // Derive the floor from the context's current bounds every wheel tick — when
      // the camera was restored from a saved layout, fitToScreen never ran, so
      // minZoomRef would otherwise still hold the default and trap large contexts
      // zoomed in with no way out to the overview.
      const fit = computeFitView();
      if (fit) minZoomRef.current = Math.min(minZoomRef.current, minZoomFor(fit.fitZoom));

      updateTransform(prev => {
        const newK = Math.max(minZoomRef.current, Math.min(prev.k * factor, 8));

        const contextPosBefore = {
          x: (mouseX - prev.x) / prev.k,
          y: (mouseY - prev.y) / prev.k
        };

        const contextPosAfter = {
          x: (mouseX - prev.x) / newK,
          y: (mouseY - prev.y) / newK
        };

        return {
          x: prev.x + (contextPosAfter.x - contextPosBefore.x) * newK,
          y: prev.y + (contextPosAfter.y - contextPosBefore.y) * newK,
          k: newK
        };
      });
      if (isLayoutReadyRef.current) schedulePersist(collectPositions, () => transformRef.current);
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, [updateTransform, schedulePersist, collectPositions, computeFitView, minZoomFor]);

  // Block the browser's pinch-to-zoom (ctrl+wheel) across the whole window while
  // the context is mounted. The canvas listener above only prevents default over
  // the canvas itself; on small screens the canvas is ringed by page chrome
  // (toolbar/search/sidebar), so an accidental trackpad pinch whose centroid
  // lands off-canvas zooms the entire page in — and scrolling over the context
  // can't undo a browser page-zoom, which reads to users as "I zoomed in and
  // can't zoom back out." Swallowing ctrl+wheel here keeps page zoom from ever
  // engaging on the context view.
  useEffect(() => {
    const handlePinchZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener('wheel', handlePinchZoom, { passive: false });
    return () => window.removeEventListener('wheel', handlePinchZoom);
  }, []);

  // Auto-zoom to focused node with smooth animation
  useEffect(() => {
    if (!autoZoomToFocus || !focusNodeId) {
      if (!focusNodeId) {
        prevAutoZoomFocusRef.current = null;
      }
      return;
    }

    if (prevAutoZoomFocusRef.current === focusNodeId) return;

    const focusedNode = nodes.find(n => String(n.id) === String(focusNodeId));
    // Not on screen yet (search reveals/expansions land a commit later) —
    // leave the ref unstamped so the next nodes update retries the zoom.
    if (!focusedNode || typeof focusedNode.x !== 'number' || typeof focusedNode.y !== 'number') return;
    prevAutoZoomFocusRef.current = focusNodeId;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = canvas.getBoundingClientRect();
    const targetZoom = 1.5;

    const targetX = width / 2 - focusedNode.x * targetZoom;
    const targetY = height / 2 - focusedNode.y * targetZoom;

    animateTransform({ x: targetX, y: targetY, k: targetZoom });
  }, [focusNodeId, nodes, autoZoomToFocus, animateTransform]);

  // Auto-fit to show entire context on initial load or when search is cleared
  useEffect(() => {
    if (!isLayoutReady || nodes.length === 0) return;

    const focusCleared = prevFocusNodeIdRef.current != null && focusNodeId == null;
    prevFocusNodeIdRef.current = focusNodeId ?? null;

    if ((hasInitialFitRef.current && !focusCleared) || focusNodeId != null) {
      return;
    }

    fitToScreen(!hasInitialFitRef.current ? false : true);
  }, [isLayoutReady, focusNodeId, nodes, fitToScreen]);

  /* --------------------------------------------------------------------------
     RENDER
     -------------------------------------------------------------------------- */

  const cursorClass = `cursor-${cursorStyle}`;

  return (
    <div
      ref={containerRef}
      className="w-full h-full relative"
      style={{
        overflow: 'hidden',
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none'
      }}
    >
      <canvas
        ref={canvasRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={`w-full h-full ${cursorClass}`}
        style={{
          touchAction: 'none',
          display: 'block',
        }}
      />
    </div>
  );
};

export default ContextCanvas;
