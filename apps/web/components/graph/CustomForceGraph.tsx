'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as d3Force from 'd3-force';
import { NodeTypeConfig, CommunityAlias, getNodeTypeConfig } from '@/lib/types';
import { CARD_DIMENSIONS, OBSIDIAN_PHYSICS as P } from './utils/constants';
import { drawLinks } from './renderers/LinkRenderer';
import { drawHexagonNode } from './renderers/HexagonNodeRenderer';
import { drawRectangleNode, type CanvasTheme } from './renderers/RectangleNodeRenderer';
import { drawCircleNode } from './renderers/CircleNodeRenderer';
import { preloadImages, loadImage } from './utils/imageCache';

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
}> = ({ nodes, links, focusNodeId, dimmedNodeIds, autoZoomToFocus = false, onNodeClick, onNodeHover, savedPositionsRef, nodeTypes, communityAliases, onRerunLayout }) => {

  /* --------------------------------------------------------------------------
     STATE & REFS
     -------------------------------------------------------------------------- */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderScheduledRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragNodeRef = useRef<SimNode | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
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

  const isPointInHexagon = useCallback((px: number, py: number, cx: number, cy: number, radius: number): boolean => {
    const vertices: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 3;
      vertices.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle)
      });
    }

    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x;
      const yi = vertices[i].y;
      const xj = vertices[j].x;
      const yj = vertices[j].y;

      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
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
  }, [nodes, nodeTypes, screenToGraph, isPointInHexagon]);

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
    const aliasConfig = nodeAlias
      ? (communityAliases ?? []).find(a => a.name === nodeAlias && a.nodeType === node.type)
      : undefined;
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

    // Draw Links
    const allNodesDimmed = nodes.length > 0 && nodes.every(n => currentDimmedNodeIds.has(String(n.id)));
    const shouldDrawLinks = (!currentFocusNodeId && !allNodesDimmed) || focusNodeExists;

    if (shouldDrawLinks) {
      drawLinks(ctx, links, nodes, transform, currentFocusNodeId);
    }

    // Draw Nodes with viewport culling
    const renderNow = performance.now();
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
      const fadeAlpha = Math.max(0, Math.min(1, elapsed / P.fadeInDurationMs));

      ctx.save();
      ctx.globalAlpha = (shouldDim ? 0.15 : 1) * fadeAlpha;
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
        if (savedPositionsRef) {
          sim.nodes().forEach(node => {
            if (typeof node.x === 'number' && typeof node.y === 'number') {
              savedPositionsRef.current.set(node.id, { x: node.x, y: node.y });
            }
          });
        }
        isLayoutReadyRef.current = true;
        setIsLayoutReady(true);
      }
    };

    simRafRef.current = requestAnimationFrame(loop);
  }, [scheduleRender, savedPositionsRef]);

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
    const HALF_W = CARD_DIMENSIONS.WIDTH / 2 + GAP / 2;
    const HALF_H = CARD_DIMENSIONS.HEIGHT / 2 + GAP / 2;
    const RECT_STRENGTH = P.rectCollideStrength;
    const RECT_ITERATIONS = 8;
    const CELL_SIZE = Math.max(HALF_W, HALF_H) * 2.5;

    function forceRectCollide() {
      let nodeArray: SimNode[] = [];

      function force() {
        for (let iter = 0; iter < RECT_ITERATIONS; iter++) {
          const grid = new Map<string, SimNode[]>();
          for (let i = 0; i < nodeArray.length; i++) {
            const node = nodeArray[i];
            if (typeof node.x !== 'number' || typeof node.y !== 'number') continue;
            const key = `${Math.floor(node.x / CELL_SIZE)},${Math.floor(node.y / CELL_SIZE)}`;
            const cell = grid.get(key);
            if (cell) cell.push(node); else grid.set(key, [node]);
          }

          for (let i = 0; i < nodeArray.length; i++) {
            const a = nodeArray[i];
            if (typeof a.x !== 'number' || typeof a.y !== 'number') continue;
            const gx = Math.floor(a.x / CELL_SIZE);
            const gy = Math.floor(a.y / CELL_SIZE);

            for (let ox = -1; ox <= 1; ox++) {
              for (let oy = -1; oy <= 1; oy++) {
                const cell = grid.get(`${gx + ox},${gy + oy}`);
                if (!cell) continue;
                for (let ci = 0; ci < cell.length; ci++) {
                  const b = cell[ci];
                  if (b === a || (b.index !== undefined && a.index !== undefined && b.index <= a.index)) continue;
                  if (typeof b.x !== 'number' || typeof b.y !== 'number') continue;

                  const dx = b.x - a.x;
                  const dy = b.y - a.y;
                  const overlapX = HALF_W * 2 - Math.abs(dx);
                  const overlapY = HALF_H * 2 - Math.abs(dy);
                  if (overlapX <= 0 || overlapY <= 0) continue;

                  let pushX = 0, pushY = 0;
                  if (overlapX < overlapY) {
                    pushX = (overlapX / 2) * RECT_STRENGTH * Math.sign(dx || 1);
                  } else {
                    pushY = (overlapY / 2) * RECT_STRENGTH * Math.sign(dy || 1);
                  }

                  a.x! -= pushX; a.y! -= pushY;
                  b.x! += pushX; b.y! += pushY;
                  if (a.vx !== undefined) a.vx -= pushX * 0.3;
                  if (a.vy !== undefined) a.vy -= pushY * 0.3;
                  if (b.vx !== undefined) b.vx += pushX * 0.3;
                  if (b.vy !== undefined) b.vy += pushY * 0.3;
                }
              }
            }
          }
        }
      }

      force.initialize = (n: SimNode[]) => { nodeArray = n; };
      return force;
    }

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
      .force('rectCollide', forceRectCollide())
      .force('isolatedRing',
        d3Force.forceRadial<SimNode>(
          d => connectedIds.has(String(d.id)) ? 0 : P.linkDistance * P.isolatedRingMultiplier,
          0, 0
        ).strength(d => connectedIds.has(String(d.id)) ? 0 : P.isolatedRingStrength)
      )
      .stop();

    simulationRef.current = sim;
    startSimLoop();

    return () => {
      sim.stop();
      if (simRafRef.current !== null) {
        cancelAnimationFrame(simRafRef.current);
        simRafRef.current = null;
      }
    };
  }, [nodes, links, startSimLoop]);

  // Preload images for nodes and trigger re-render when loaded
  useEffect(() => {
    const imageUrls = nodes
      .map(node => node.image_url)
      .filter((url): url is string => !!url);

    if (imageUrls.length === 0) return;

    imageUrls.forEach(url => loadImage(url));

    preloadImages(imageUrls).then(() => {
      scheduleRender();
    });
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
      isDraggingRef.current = true;
      setCursorStyle('move');
      dragNodeRef.current = node;
      const graphPos = screenToGraph(x, y);
      dragOffsetRef.current = {
        x: graphPos.x - node.x,
        y: graphPos.y - node.y
      };
      node.fx = node.x;
      node.fy = node.y;
      simulationRef.current?.alphaTarget(0.3).restart();
      startSimLoop();
    } else {
      isPanningRef.current = true;
      setCursorStyle('grabbing');
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  }, [findNodeAt, screenToGraph, startSimLoop]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isDraggingRef.current && dragNodeRef.current && dragOffsetRef.current) {
      const rect = canvas.getBoundingClientRect();
      const graphPos = screenToGraph(e.clientX - rect.left, e.clientY - rect.top);

      const newX = graphPos.x - dragOffsetRef.current.x;
      const newY = graphPos.y - dragOffsetRef.current.y;
      dragNodeRef.current.fx = newX;
      dragNodeRef.current.fy = newY;
      dragNodeRef.current.x = newX;
      dragNodeRef.current.y = newY;
    } else if (isPanningRef.current && dragStartRef.current) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      updateTransform(prev => ({
        ...prev,
        x: prev.x + dx,
        y: prev.y + dy
      }));

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
  }, [screenToGraph, updateTransform, findNodeAt, onNodeHover]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (mouseDownPosRef.current && mouseDownNodeRef.current && onNodeClick) {
      const dx = e.clientX - mouseDownPosRef.current.x;
      const dy = e.clientY - mouseDownPosRef.current.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const CLICK_THRESHOLD = 5;
      if (distance < CLICK_THRESHOLD) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const node = findNodeAt(x, y);

        if (node && node.id === mouseDownNodeRef.current.id) {
          onNodeClick(node);
        }
      }
    }

    if (isDraggingRef.current && dragNodeRef.current) {
      const node = dragNodeRef.current;
      node.fx = null;
      node.fy = null;
      simulationRef.current?.alphaTarget(0).restart();
      startSimLoop();
    }

    isDraggingRef.current = false;
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
  }, [onNodeClick, findNodeAt, startSimLoop]);

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

    const startTransform = { ...transformRef.current };
    const duration = 600;
    const startTime = performance.now();
    const animateFrame = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      transformRef.current = {
        x: startTransform.x + (targetX - startTransform.x) * eased,
        y: startTransform.y + (targetY - startTransform.y) * eased,
        k: startTransform.k + (targetZoom - startTransform.k) * eased
      };
      scheduleRender();
      if (progress < 1) requestAnimationFrame(animateFrame);
    };
    requestAnimationFrame(animateFrame);
  }, [nodes, scheduleRender]);

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
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
    };
  }, [updateTransform]);

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

    const startTransform = { ...transformRef.current };
    const duration = 600;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      const eased = 1 - Math.pow(1 - progress, 3);

      transformRef.current = {
        x: startTransform.x + (targetX - startTransform.x) * eased,
        y: startTransform.y + (targetY - startTransform.y) * eased,
        k: startTransform.k + (targetZoom - startTransform.k) * eased
      };
      scheduleRender();

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [focusNodeId, nodes, autoZoomToFocus, scheduleRender]);

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
      {/* Re-run Layout button */}
      {onRerunLayout && (
        <button
          onClick={onRerunLayout}
          className="absolute bottom-4 right-4 px-4 py-2 rounded-lg font-medium transition-all duration-200 shadow-lg bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
          title="Re-run force layout"
        >
          <span className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
            Re-layout
          </span>
        </button>
      )}
    </div>
  );
};

export default CustomForceGraph;
