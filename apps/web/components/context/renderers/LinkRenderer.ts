/**
 * Link renderer for context connections.
 *
 * At rest every edge is a quiet near-black hairline. When the user focuses or
 * hovers a node — or a path between two nodes is lit — the involved edges take
 * on their relationship type's colour, a midpoint label naming the
 * relationship, and a direction chevron for directed types. Straight lines by
 * default; gentle fan-out only when multiple edges share the same pair of
 * endpoints, so they don't visually merge.
 */

import { NBNode, LinkTypeConfig, NodeTypeConfig, getNodeTypeConfig } from '@/lib/types';
import { getLinkTypeConfig } from '@/lib/context/relationships';
import { isFolderNodeId, isAliasNodeId, folderCount, folderRadius, aliasRadius } from '@/lib/context/folderView';
import { isNoteNodeId, NOTE_NODE_RADIUS } from '@/lib/context/brainView';
import { OBSIDIAN_PHYSICS as P, CARD_DIMENSIONS } from '../utils/constants';
import { roundRect } from '../utils/canvasUtils';

interface SimNode extends NBNode {
  x?: number;
  y?: number;
  spawnTime?: number;
  spawnIndex?: number;
}

interface SimLink {
  source: SimNode | string;
  target: SimNode | string;
  relationship?: string;
  /** Aggregated edges (folder view) carry how many underlying links they stand for. */
  weight?: number;
  /** Quiet edges (brain view mentions) draw only while focus/hover lights them. */
  quiet?: boolean;
}

/** Aggregated edges thicken with the log of what they stand for, capped so a
 *  heavy folder↔folder edge stays a line, not a band. */
const weightScale = (weight: number | undefined): number =>
  weight && weight > 1 ? Math.min(3, 1 + Math.log2(weight) * 0.6) : 1;

interface Transform {
  x: number;
  y: number;
  k: number;
}

/** Viewport bounds in context coordinates, used to skip clearly off-screen links. */
export interface ViewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Which edges are lit and how hard the rest should recede. */
export interface LinkHighlightState {
  focusNodeId: string | null;
  hoveredNodeId: string | null;
  /** Identity set of the links on the active focus→hover path (null = no path lit). */
  pathLinks: Set<SimLink> | null;
}

// Labels stay readable at any zoom (screen-constant size) but would collide
// when many edges are lit at once — cap how many get text.
const MAX_EDGE_LABELS = 24;
// Skip labels on edges shorter than this on screen; the pill wouldn't fit.
const MIN_LABEL_SCREEN_DIST = 90;

export interface PendingLabel {
  x: number;
  y: number;
  text: string;
  color: string;
  /** Unit direction of the edge (source → target) for the chevron. */
  dx: number;
  dy: number;
  directed: boolean;
  alpha: number;
}

/** Half-extents of the rectangle a node's card occupies, for label placement. */
function cardHalfExtents(node: SimNode, nodeTypes: NodeTypeConfig[] | undefined): { hw: number; hh: number } {
  const id = String(node.id);
  if (isFolderNodeId(id)) {
    const r = folderRadius(folderCount(node));
    return { hw: r, hh: r };
  }
  if (isAliasNodeId(id)) {
    const r = aliasRadius(folderCount(node));
    return { hw: r, hh: r };
  }
  if (isNoteNodeId(id)) {
    return { hw: NOTE_NODE_RADIUS, hh: NOTE_NODE_RADIUS };
  }
  const shape = getNodeTypeConfig(node.type, nodeTypes).shape;
  if (shape === 'square' || shape === 'hexagon') {
    return {
      hw: CARD_DIMENSIONS.SQUARE_SIDE / 2,
      hh: (CARD_DIMENSIONS.SQUARE_SIDE + CARD_DIMENSIONS.SQUARE_CAPTION) / 2,
    };
  }
  return { hw: CARD_DIMENSIONS.WIDTH / 2, hh: CARD_DIMENSIONS.HEIGHT / 2 };
}

/**
 * Fraction along source→target where the segment leaves an axis-aligned card
 * rectangle centred on the source endpoint.
 */
function rectExitT(dx: number, dy: number, hw: number, hh: number): number {
  const tX = dx !== 0 ? hw / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const tY = dy !== 0 ? hh / Math.abs(dy) : Number.POSITIVE_INFINITY;
  return Math.min(tX, tY);
}

/**
 * Draws the link lines and returns the relationship labels to be drawn AFTER
 * the node cards (drawEdgeLabels), so a pill is never hidden behind a card.
 */
export function drawLinks(
  ctx: CanvasRenderingContext2D,
  links: SimLink[],
  nodes: SimNode[],
  transform: Transform,
  highlight: LinkHighlightState,
  linkTypes: LinkTypeConfig[] | undefined,
  now: number,
  reduceMotion: boolean,
  bounds?: ViewBounds,
  nodeTypes?: NodeTypeConfig[]
): PendingLabel[] {
  const { focusNodeId, hoveredNodeId, pathLinks } = highlight;
  const pathActive = pathLinks !== null;

  // Resolve string endpoints through a map instead of nodes.find() per link
  // (O(L) instead of O(L×N) when links haven't been bound to node objects yet).
  const nodeById = new Map<string, SimNode>();
  nodes.forEach(n => nodeById.set(String(n.id), n));

  // Resolve each relationship's type config once per frame, not once per edge.
  const typeConfigCache = new Map<string, LinkTypeConfig>();
  const configFor = (relationship: string | undefined): LinkTypeConfig => {
    const key = relationship ?? '';
    let config = typeConfigCache.get(key);
    if (!config) {
      config = getLinkTypeConfig(key, linkTypes);
      typeConfigCache.set(key, config);
    }
    return config;
  };

  // Detect parallel edges between the same pair of endpoints; those get a small
  // curve offset so they don't render on top of each other.
  const edgePairCount = new Map<string, number>();
  const edgePairIndex = new Map<SimLink, number>();

  links.forEach(link => {
    const sourceId = String(typeof link.source === 'string' ? link.source : (link.source as SimNode).id);
    const targetId = String(typeof link.target === 'string' ? link.target : (link.target as SimNode).id);
    const pairKey = sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
    const idx = edgePairCount.get(pairKey) || 0;
    edgePairCount.set(pairKey, idx + 1);
    edgePairIndex.set(link, idx);
  });

  // Labels are drawn after every line so they sit on top of neighbouring edges.
  const pendingLabels: PendingLabel[] = [];

  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id;
    const targetId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id;

    const source = typeof link.source === 'string'
      ? nodeById.get(sourceId) : link.source as SimNode;
    const target = typeof link.target === 'string'
      ? nodeById.get(targetId) : link.target as SimNode;

    // Coordinate checks must be typeof, not truthiness — a node at exactly
    // x=0 (the home node sits at the ring origin) is valid, not missing.
    if (
      typeof source?.x !== 'number' || typeof source?.y !== 'number' ||
      typeof target?.x !== 'number' || typeof target?.y !== 'number'
    ) return;

    // Conservative cull: skip links whose endpoints are both past the same
    // viewport edge — such a segment can't cross the viewport. Big win when
    // zoomed in on a dense context.
    if (bounds) {
      if (
        (source.x < bounds.left && target.x < bounds.left) ||
        (source.x > bounds.right && target.x > bounds.right) ||
        (source.y < bounds.top && target.y < bounds.top) ||
        (source.y > bounds.bottom && target.y > bounds.bottom)
      ) return;
    }

    const sId = String(source.id);
    const tId = String(target.id);
    const isPathLink = pathLinks?.has(link) ?? false;
    const isFocusLink = focusNodeId != null && (sId === focusNodeId || tId === focusNodeId);
    const isHoverLink = hoveredNodeId != null && (sId === hoveredNodeId || tId === hoveredNodeId);
    // While a path is lit, only path edges stay bright — even the focus node's
    // other edges recede so the route reads unambiguously.
    const isLit = pathActive ? isPathLink : (isFocusLink || isHoverLink);
    const anyEmphasis = pathActive || focusNodeId != null || hoveredNodeId != null;

    // Quiet edges exist only while lit — at rest the brain view's structure
    // tree is the whole picture, not the mention hairball on top of it.
    if (link.quiet && !isLit) return;

    // Fade each link in alongside its later-appearing endpoint, mirroring the
    // node fade in ContextCanvas (same duration/stagger constants). Skip the
    // tween entirely for reduced-motion users.
    const fadeAlpha = reduceMotion
      ? 1
      : (() => {
          const stagger = Math.max(source.spawnIndex ?? 0, target.spawnIndex ?? 0) * P.fadeInStaggerMs;
          const spawnTime = Math.max(source.spawnTime ?? now, target.spawnTime ?? now);
          const elapsed = now - spawnTime - stagger;
          return Math.max(0, Math.min(1, elapsed / P.fadeInDurationMs));
        })();
    if (fadeAlpha <= 0) return;

    const config = isLit ? configFor(link.relationship) : null;

    ctx.save();
    ctx.globalAlpha = fadeAlpha;

    const wScale = weightScale(link.weight);
    if (isLit && config) {
      ctx.strokeStyle = config.color;
      ctx.globalAlpha = fadeAlpha * 0.95;
      ctx.lineWidth = ((isPathLink ? 3.2 : 2.4) * wScale) / transform.k;
    } else if (anyEmphasis) {
      ctx.strokeStyle = 'rgba(17,24,39,1)';
      ctx.globalAlpha = fadeAlpha * (pathActive ? 0.03 : 0.05);
      ctx.lineWidth = (1.1 * wScale) / transform.k;
    } else {
      ctx.strokeStyle = 'rgba(17,24,39,0.18)';
      ctx.lineWidth = (1.1 * wScale) / transform.k;
    }

    const pairKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
    const pairTotal = edgePairCount.get(pairKey) || 1;
    const pairIdx = edgePairIndex.get(link) || 0;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);

    // Place the label at the midpoint of the VISIBLE part of the edge — the
    // gap between the two card boundaries — not the raw segment midpoint,
    // which on a short edge sits under one of the cards.
    const segDx = target.x - source.x;
    const segDy = target.y - source.y;
    let labelT = 0.5;
    if (isLit) {
      const sExt = cardHalfExtents(source, nodeTypes);
      const tExt = cardHalfExtents(target, nodeTypes);
      const tExit = rectExitT(segDx, segDy, sExt.hw, sExt.hh);
      const tEntry = 1 - rectExitT(segDx, segDy, tExt.hw, tExt.hh);
      if (tExit < tEntry) labelT = (tExit + tEntry) / 2;
    }

    let midX = source.x + segDx * labelT;
    let midY = source.y + segDy * labelT;
    if (pairTotal > 1) {
      const fanOffset = (pairIdx - (pairTotal - 1) / 2) * 0.1;
      const cpX = (source.x + target.x) / 2 + segDy * fanOffset;
      const cpY = (source.y + target.y) / 2 - segDx * fanOffset;
      ctx.quadraticCurveTo(cpX, cpY, target.x, target.y);
      // Quadratic Bézier at t: (1−t)²·p0 + 2t(1−t)·cp + t²·p1.
      const u = 1 - labelT;
      midX = u * u * source.x + 2 * labelT * u * cpX + labelT * labelT * target.x;
      midY = u * u * source.y + 2 * labelT * u * cpY + labelT * labelT * target.y;
    } else {
      ctx.lineTo(target.x, target.y);
    }

    ctx.stroke();
    ctx.restore();

    if (isLit && config && pendingLabels.length < MAX_EDGE_LABELS) {
      const dist = Math.hypot(target.x - source.x, target.y - source.y);
      if (dist * transform.k >= MIN_LABEL_SCREEN_DIST && dist > 0) {
        pendingLabels.push({
          x: midX,
          y: midY,
          text: config.name,
          color: config.color,
          dx: (target.x - source.x) / dist,
          dy: (target.y - source.y) / dist,
          directed: config.directed === true,
          alpha: fadeAlpha,
        });
      }
    }
  });

  return pendingLabels;
}

/**
 * Pills naming the relationship, in screen-constant size so they stay
 * readable at any zoom. Directed types get a chevron pointing source → target
 * just past the pill. Called by the canvas after the node pass, so labels sit
 * on top of cards instead of disappearing behind them.
 */
export function drawEdgeLabels(ctx: CanvasRenderingContext2D, labels: PendingLabel[], transform: Transform): void {
  if (labels.length === 0) return;
  const k = transform.k;
  const fontSize = 11 / k;
  const padX = 6 / k;
  const padY = 3.5 / k;
  const radius = 8 / k;

  ctx.save();
  ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  labels.forEach(label => {
    const textWidth = ctx.measureText(label.text).width;
    const w = textWidth + padX * 2;
    const h = fontSize + padY * 2;

    ctx.globalAlpha = label.alpha;

    roundRect(ctx, label.x - w / 2, label.y - h / 2, w, h, Math.min(radius, h / 2));
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.strokeStyle = label.color;
    ctx.lineWidth = 1 / k;
    ctx.stroke();

    ctx.fillStyle = label.color;
    ctx.fillText(label.text, label.x, label.y);

    if (label.directed) {
      // Chevron just past the pill's trailing edge, pointing source → target.
      const off = w / 2 + 9 / k;
      const cx = label.x + label.dx * off;
      const cy = label.y + label.dy * off;
      const s = 5 / k;
      const px = -label.dy; // perpendicular
      const py = label.dx;
      ctx.beginPath();
      ctx.moveTo(cx + label.dx * s, cy + label.dy * s);
      ctx.lineTo(cx - label.dx * s + px * s, cy - label.dy * s + py * s);
      ctx.lineTo(cx - label.dx * s - px * s, cy - label.dy * s - py * s);
      ctx.closePath();
      ctx.fillStyle = label.color;
      ctx.fill();
    }
  });

  ctx.restore();
}
