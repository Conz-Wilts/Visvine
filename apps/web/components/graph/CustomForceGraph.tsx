'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import { NodeTypeConfig, CommunityAlias, getNodeTypeConfig, findAlias } from '@/lib/types';
import { CARD_DIMENSIONS, OBSIDIAN_PHYSICS as P } from './utils/constants';
import { drawLinks } from './renderers/LinkRenderer';
import { drawHexagonNode } from './renderers/HexagonNodeRenderer';
import { drawRectangleNode, type CanvasTheme } from './renderers/RectangleNodeRenderer';
import { drawCircleNode } from './renderers/CircleNodeRenderer';
import { preloadImages } from './utils/imageCache';
import { createRectCollideForce } from './utils/forceRectCollide';
import { isPointInHexagon } from './utils/hitTest';
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
}

export interface Transform {
  x: number;
  y: number;
  k: number;
}

/* ============================================================================
   FORCE GRAPH CANVAS COMPONENT
   ============================================================================ */

// Pointer travel (in screen px) below which a press counts as a click, not a
// drag. Used both to start a drag and to fire onNodeClick — keep them in sync.
const DRAG_THRESHOLD = 5;

const CustomForceGraph: React.FC<{
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
  onRerunLayout?: () => void;
  /** When false, the incoming node positions are a final layout (server
   *  restore or precomputed engine result) — freeze the simulation and apply
   *  `initialTransform` (or auto-fit) instead of running a cold burst. */
  coldStart?: boolean;
  initialTransform?: Transform | null;
  /** Persist the frozen layout once after mounting it. Used for freshly
   *  precomputed layouts (which the server hasn't seen yet) — a plain server
   *  restore leaves this false so it isn't pointlessly written back. */
  persistOnRestore?: boolean;
  /** Called (debounced) when the layout settles, a node is dragged, or the user
   *  pans/zooms — so the parent can persist positions + camera transform. */
  onPersistLayout?: (positions: Record<string, { x: number; y: number }>, transform: Transform) => void;
}> = ({ nodes, links, focusNodeId, dimmedNodeIds, autoZoomToFocus = false, onNodeClick, onNodeHover, savedPositionsRef, nodeTypes, communityAliases, onRerunLayout, coldStart = true, initialTransform = null, persistOnRestore = false, onPersistLayout }) => {

  /* --------------------------------------------------------------------------
     STATE & REFS
     -------------------------------------------------------------------------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderScheduledRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragNodeRef = useRef<SimNode | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  // True once a press-on-node has moved past the click threshold and become a
  // real drag. Until then nothing is touched, so a plain click/hold moves
  // nothing. A real drag moves ONLY the grabbed node — the simulation is never
  // reheated, because on-screen positions come from the layout engine (or a
  // server restore), not from this sim's equilibrium; restarting it would pull
  // every node toward the d3 forces and collapse the layout.
  const dragStartedRef = useRef(false);
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
  // instant, static graph.
  const reduceMotionRef = useRef(prefersReducedMotion());

  // Layout persistence: cold/drag → persist on settle; restore → don't persist
  // back; pan/zoom → debounced. (See ./hooks/useLayoutPersistence.)
  const { markDirty, flushOnSettle, schedulePersist } = useLayoutPersistence(onPersistLayout);
  const coldStartRef = useRef(coldStart);
  coldStartRef.current = coldStart;
  const initialTransformRef = useRef(initialTransform);
  initialTransformRef.current = initialTransform;
  const persistOnRestoreRef = useRef(persistOnRestore);
  persistOnRestoreRef.current = persistOnRestore;

  // Use refs for values that change frequently during interactions to avoid React re-renders
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const isDraggingRef = useRef(false);
  const isPanningRef = useRef(false);

  // Refs to stabilize render callback - these are synced from props before rendering
  const focusNodeIdRef = useRef<string | null>(null);
  const dimmedNodeIdsRef = useRef<Set<string>>(new Set());

  const [isLayoutReady, setIsLayoutReady] = useState(false);
  const isLayoutReadyRef = useRef(false);
  const [, setIsInitialFitComplete] = useState(false);
  const [cursorStyle, setCursorStyle] = useState<'grab' | 'grabbing' | 'move' | 'pointer'>('grab');

  /* --------------------------------------------------------------------------
     UTILITIES
     -------------------------------------------------------------------------- */

  const screenToGraph = useCallback((screenX: number, screenY: number) => {
    const transform = transformRef.current;
    return {
      x: (screenX - transform.x) / transform.k,
      y: (screenY - transform.y) / transform.k
    };
  }, []);

  const findNodeAt = useCallback((screenX: number, screenY: number) => {
    const graphPos = screenToGraph(screenX, screenY);
    return nodes.find(node => {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') return false;

      const shape = getNodeTypeConfig(node.type, nodeTypes).shape;

      if (shape === 'hexagon') {
        const hexRadius = Math.max(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) * 0.75;
        return isPointInHexagon(graphPos.x, graphPos.y, node.x, node.y, hexRadius);
      } else {
        const halfWidth = CARD_DIMENSIONS.WIDTH / 2;
        const halfHeight = CARD_DIMENSIONS.HEIGHT / 2;
        return (
          graphPos.x >= node.x - halfWidth &&
          graphPos.x <= node.x + halfWidth &&
          graphPos.y >= node.y - halfHeight &&
          graphPos.y <= node.y + halfHeight
        );
      }
    });
  }, [nodes, nodeTypes, screenToGraph]);

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
    simplified: boolean,
    isFocused: boolean,
    isConnected: boolean,
    shouldDim: boolean
  ) => {
    if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

    const typeConfig = getNodeTypeConfig(node.type, nodeTypes);
    // Alias colour overrides base type colour, matching how the directory card
    // resolves colour. Without this, Founder/Investor/Government nodes in the
    // graph view fall back to the base type colour and lose their distinction.
    const nodeAlias = (node as { alias?: string | null }).alias;
    const aliasConfig = findAlias(communityAliases, nodeAlias, node.type);
    const borderColor = aliasConfig?.color ?? typeConfig.color;
    const shape = typeConfig.shape;

    const borderWidth = isFocused ? CARD_DIMENSIONS.BORDER_WIDTH * 1.6 : CARD_DIMENSIONS.BORDER_WIDTH;
    const theme = getCanvasTheme();

    if (shape === 'hexagon') {
      drawHexagonNode(ctx, node, node.x, node.y, simplified, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    } else if (shape === 'circle') {
      drawCircleNode(ctx, node, node.x, node.y, simplified, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    } else {
      drawRectangleNode(ctx, node, node.x, node.y, simplified, isFocused, isConnected, shouldDim, borderColor, borderWidth, theme);
    }
  }, [nodeTypes, communityAliases, getCanvasTheme]);

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

    // Viewport culling bounds (in graph coordinates)
    const cssWidth = width / dpr;
    const cssHeight = height / dpr;
    const viewLeft = -transform.x / transform.k;
    const viewTop = -transform.y / transform.k;
    const viewRight = (cssWidth - transform.x) / transform.k;
    const viewBottom = (cssHeight - transform.y) / transform.k;
    const cullPad = Math.max(CARD_DIMENSIONS.WIDTH, CARD_DIMENSIONS.HEIGHT) * 1.5;

    // Calculate connected nodes if there's a focused node
    const connectedNodeIds = new Set<string>();
    let focusNodeExists = false;
    if (currentFocusNodeId) {
      focusNodeExists = nodes.some(n => String(n.id) === String(currentFocusNodeId));

      if (focusNodeExists) {
        links.forEach(link => {
          const sourceId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id;
          const targetId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id;

          if (String(sourceId) === String(currentFocusNodeId)) {
            connectedNodeIds.add(String(targetId));
          } else if (String(targetId) === String(currentFocusNodeId)) {
            connectedNodeIds.add(String(sourceId));
          }
        });
      }
    }

    const renderNow = performance.now();

    // Draw Links
    const allNodesDimmed = nodes.length > 0 && nodes.every(n => currentDimmedNodeIds.has(String(n.id)));
    const shouldDrawLinks = (!currentFocusNodeId && !allNodesDimmed) || focusNodeExists;

    if (shouldDrawLinks) {
      drawLinks(ctx, links, nodes, transform, currentFocusNodeId, renderNow, reduceMotionRef.current);
    }

    // Draw Nodes with viewport culling
    nodes.forEach(node => {
      if (typeof node.x !== 'number' || typeof node.y !== 'number') return;

      if (
        node.x < viewLeft - cullPad || node.x > viewRight + cullPad ||
        node.y < viewTop - cullPad || node.y > viewBottom + cullPad
      ) return;

      const isFocused = currentFocusNodeId != null && String(node.id) === String(currentFocusNodeId);
      const isConnected = currentFocusNodeId != null && connectedNodeIds.has(String(node.id));
      const isInDimmedSet = currentDimmedNodeIds?.has(String(node.id)) ?? false;

      const shouldDim = !isFocused && !isConnected && (isInDimmedSet || currentFocusNodeId != null);

      const stagger = (node.spawnIndex ?? 0) * P.fadeInStaggerMs;
      const elapsed = renderNow - (node.spawnTime ?? renderNow) - stagger;
      const fadeAlpha = reduceMotionRef.current
        ? 1
        : Math.max(0, Math.min(1, elapsed / P.fadeInDurationMs));

      ctx.save();
      ctx.globalAlpha = (shouldDim ? 0.15 : 1) * fadeAlpha;
      // Ease each node up into place as it fades in. Purely a draw-time offset —
      // node.x/node.y (and the persisted layout) are never touched.
      const rise = (1 - fadeAlpha) * P.fadeInRiseY;
      if (rise) ctx.translate(0, rise);
      drawNodeCard(ctx, node, false, isFocused, isConnected, shouldDim);
      ctx.restore();
    });

    ctx.restore();
  }, [nodes, links, drawNodeCard]);

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

      // First mount of a new graph: keep canvas blank for the first few ticks
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
  const playFadeIn = useCallback((startNow: number, count: number) => {
    if (introRafRef.current !== null) cancelAnimationFrame(introRafRef.current);
    const total = P.fadeInDurationMs + count * P.fadeInStaggerMs + 50;
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

    // Card-aware rectangular collision (Obsidian dots don't need this; cards do).
    // Charge does most of the spacing work — rectCollide just guarantees no overlap.
    const GAP = P.rectCollideGap;
    const RECT_HALF_W = CARD_DIMENSIONS.WIDTH / 2 + GAP / 2;
    const RECT_HALF_H = CARD_DIMENSIONS.HEIGHT / 2 + GAP / 2;
    const rectCollide = createRectCollideForce<SimNode>({
      halfW: RECT_HALF_W,
      halfH: RECT_HALF_H,
      strength: P.rectCollideStrength,
      iterations: 8,
      cellSize: Math.max(RECT_HALF_W, RECT_HALF_H) * 2.5,
    });

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
          .distance(P.linkDistance)
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
      .force('rectCollide', rectCollide)
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
    // the fade already elapsed, popping the graph in flat).
    const introStart = typeof performance !== 'undefined' ? performance.now() : 0;
    nodes.forEach((node, i) => { node.spawnTime = introStart; node.spawnIndex = i; });

    let fitRaf: number | null = null;
    if (coldStartRef.current === false) {
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
        playFadeIn(introStart, nodes.length);
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
  }, [nodes, links, startSimLoop, markDirty, flushOnSettle, collectPositions, playFadeIn, scheduleRender]);

  // Warm the image cache a few at a time. Firing every request at once would
  // open hundreds of concurrent loads through the media proxy on large
  // communities, starving the initial data fetch and first paint. Visible
  // nodes don't wait on this queue: the renderers call loadImage() during
  // draw, so anything on screen starts loading immediately.
  useEffect(() => {
    const imageUrls = nodes
      .map(node => node.image_url)
      .filter((url): url is string => !!url);

    if (imageUrls.length === 0) return;

    let cancelled = false;
    const CHUNK_SIZE = 8;
    (async () => {
      for (let i = 0; i < imageUrls.length; i += CHUNK_SIZE) {
        if (cancelled) return;
        await preloadImages(imageUrls.slice(i, i + CHUNK_SIZE));
        if (cancelled) return;
        scheduleRender();
      }
    })();
    return () => { cancelled = true; };
  }, [nodes, scheduleRender]);

  /* --------------------------------------------------------------------------
     EVENT HANDLERS
     -------------------------------------------------------------------------- */

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = findNodeAt(x, y);

    mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    mouseDownNodeRef.current = node || null;

    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      // Mark this as a drag candidate only. Pinning the node and reheating the
      // simulation is deferred to handleMouseMove (once the pointer moves past
      // DRAG_THRESHOLD) so a plain click/hold doesn't make neighbours vibrate.
      isDraggingRef.current = true;
      dragStartedRef.current = false;
      setCursorStyle('move');
      dragNodeRef.current = node;
      const graphPos = screenToGraph(x, y);
      dragOffsetRef.current = {
        x: graphPos.x - node.x,
        y: graphPos.y - node.y
      };
    } else {
      isPanningRef.current = true;
      setCursorStyle('grabbing');
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  }, [findNodeAt, screenToGraph]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDraggingRef.current && dragNodeRef.current && dragOffsetRef.current) {
      // Defer the actual drag (pinning the node + reheating the simulation)
      // until the pointer has moved past the click threshold. Reheating on a
      // stationary press is what made nearby nodes vibrate.
      if (!dragStartedRef.current) {
        const downPos = mouseDownPosRef.current;
        if (downPos) {
          const ddx = e.clientX - downPos.x;
          const ddy = e.clientY - downPos.y;
          if (Math.sqrt(ddx * ddx + ddy * ddy) < DRAG_THRESHOLD) return;
        }
        dragStartedRef.current = true;
        const node = dragNodeRef.current;
        // Pin the node so a live cold-start burst (if one happens to be mid-
        // flight) can't fight the pointer. Deliberately NO alphaTarget/restart:
        // reheating the sim would move every other node, collapsing the
        // engine/restored layout toward the d3 equilibrium.
        node.fx = node.x;
        node.fy = node.y;
        // A user drag changes the layout — persist it on release (or on settle
        // if a live sim is still running).
        markDirty();
      }

      const rect = canvas.getBoundingClientRect();
      const graphPos = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);

      const newX = graphPos.x - dragOffsetRef.current.x;
      const newY = graphPos.y - dragOffsetRef.current.y;
      dragNodeRef.current.fx = newX;
      dragNodeRef.current.fy = newY;
      dragNodeRef.current.x = newX;
      dragNodeRef.current.y = newY;
      // The sim isn't ticking (frozen layout), so drive the redraw directly.
      scheduleRender();
    } else if (isPanningRef.current && dragStartRef.current) {
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

      if (node) {
        setCursorStyle('move');
        onNodeHover?.(node);
      } else {
        setCursorStyle('grab');
        onNodeHover?.(null);
      }
    }
  }, [screenToGraph, updateTransform, findNodeAt, onNodeHover, schedulePersist, collectPositions, markDirty, scheduleRender]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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

    // Only release/persist if a real drag actually started. A plain click never
    // pinned the node, so there's nothing to undo.
    if (isDraggingRef.current && dragNodeRef.current && dragStartedRef.current) {
      const node = dragNodeRef.current;
      node.fx = null;
      node.fy = null;
      // No sim restart — nothing else moved, so there's nothing to relax.
      // Record the new arrangement and persist via the shared debounce: rapid
      // consecutive drags coalesce into one write (parallel PUTs could commit
      // out of order, leaving the server one drag behind), and a drag that
      // outlives a live cold-start burst still persists its final position
      // here even after the settle handler has consumed the dirty flag.
      const positions = collectPositions();
      Object.entries(positions).forEach(([id, p]) => savedPositionsRef?.current.set(id, p));
      schedulePersist(collectPositions, () => transformRef.current);
      scheduleRender();
    }

    isDraggingRef.current = false;
    dragStartedRef.current = false;
    isPanningRef.current = false;
    dragNodeRef.current = null;
    dragStartRef.current = null;
    dragOffsetRef.current = null;
    mouseDownPosRef.current = null;
    mouseDownNodeRef.current = null;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = findNodeAt(x, y);
    setCursorStyle(node ? 'move' : 'grab');
  }, [onNodeClick, findNodeAt, collectPositions, schedulePersist, savedPositionsRef, scheduleRender]);

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

  const fitToScreen = useCallback((animate: boolean = false) => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const nodePositions = nodes.filter(n => typeof n.x === 'number' && typeof n.y === 'number');
    if (nodePositions.length === 0) return;

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
    const graphWidth = maxX - minX + padding * 2;
    const graphHeight = maxY - minY + padding * 2;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    const { width, height } = canvas.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const scaleX = width / graphWidth;
    const scaleY = height / graphHeight;
    const targetZoom = Math.min(scaleX, scaleY, 1.2);
    const targetX = width / 2 - graphCenterX * targetZoom;
    const targetY = height / 2 - graphCenterY * targetZoom;

    if (!animate) {
      transformRef.current = { x: targetX, y: targetY, k: targetZoom };
      scheduleRender();
      hasInitialFitRef.current = true;
      setIsInitialFitComplete(true);
      return;
    }

    animateTransform({ x: targetX, y: targetY, k: targetZoom });
  }, [nodes, scheduleRender, animateTransform]);

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

    const updateCanvasSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;

      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      scheduleRender();

      if (isLayoutReadyRef.current) {
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

      updateTransform(prev => {
        const newK = Math.max(0.05, Math.min(prev.k * factor, 8));

        const graphPosBefore = {
          x: (mouseX - prev.x) / prev.k,
          y: (mouseY - prev.y) / prev.k
        };

        const graphPosAfter = {
          x: (mouseX - prev.x) / newK,
          y: (mouseY - prev.y) / newK
        };

        return {
          x: prev.x + (graphPosAfter.x - graphPosBefore.x) * newK,
          y: prev.y + (graphPosAfter.y - graphPosBefore.y) * newK,
          k: newK
        };
      });
      if (isLayoutReadyRef.current) schedulePersist(collectPositions, () => transformRef.current);
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, [updateTransform, schedulePersist, collectPositions]);

  // Auto-zoom to focused node with smooth animation
  useEffect(() => {
    if (!autoZoomToFocus || !focusNodeId) {
      if (!focusNodeId) {
        prevAutoZoomFocusRef.current = null;
      }
      return;
    }

    if (prevAutoZoomFocusRef.current === focusNodeId) return;
    prevAutoZoomFocusRef.current = focusNodeId;

    const focusedNode = nodes.find(n => String(n.id) === String(focusNodeId));
    if (!focusedNode || typeof focusedNode.x !== 'number' || typeof focusedNode.y !== 'number') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const { width, height } = canvas.getBoundingClientRect();
    const targetZoom = 1.5;

    const targetX = width / 2 - focusedNode.x * targetZoom;
    const targetY = height / 2 - focusedNode.y * targetZoom;

    animateTransform({ x: targetX, y: targetY, k: targetZoom });
  }, [focusNodeId, nodes, autoZoomToFocus, animateTransform]);

  // Auto-fit to show entire graph on initial load or when search is cleared
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
        onMouseLeave={handleMouseUp}
        className={`w-full h-full ${cursorClass}`}
        style={{
          touchAction: 'none',
          display: 'block',
        }}
      />
      {onRerunLayout && isLayoutReady && (
        <button
          type="button"
          onClick={onRerunLayout}
          title="Recompute the graph layout from scratch"
          className="absolute bottom-4 right-4 z-10 rounded-lg border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:text-text-primary hover:border-surface-2"
        >
          Re-run layout
        </button>
      )}
    </div>
  );
};

export default CustomForceGraph;
