/**
 * Link renderer for graph connections.
 * Straight lines by default; gentle fan-out only when multiple edges share
 * the same pair of endpoints, so they don't visually merge.
 */

import { NBNode } from '@/lib/types';
import { OBSIDIAN_PHYSICS as P } from '../utils/constants';

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
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

/** Viewport bounds in graph coordinates, used to skip clearly off-screen links. */
export interface ViewBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function drawLinks(
  ctx: CanvasRenderingContext2D,
  links: SimLink[],
  nodes: SimNode[],
  transform: Transform,
  focusNodeId: string | null,
  now: number,
  reduceMotion: boolean,
  bounds?: ViewBounds
): void {
  // Resolve string endpoints through a map instead of nodes.find() per link
  // (O(L) instead of O(L×N) when links haven't been bound to node objects yet).
  const nodeById = new Map<string, SimNode>();
  nodes.forEach(n => nodeById.set(String(n.id), n));

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

  links.forEach(link => {
    const sourceId = typeof link.source === 'string' ? link.source : (link.source as SimNode).id;
    const targetId = typeof link.target === 'string' ? link.target : (link.target as SimNode).id;

    const source = typeof link.source === 'string'
      ? nodeById.get(sourceId) : link.source as SimNode;
    const target = typeof link.target === 'string'
      ? nodeById.get(targetId) : link.target as SimNode;

    if (!source?.x || !target?.x || typeof source.y !== 'number' || typeof target.y !== 'number') return;

    // Conservative cull: skip links whose endpoints are both past the same
    // viewport edge — such a segment can't cross the viewport. Big win when
    // zoomed in on a dense graph.
    if (bounds) {
      if (
        (source.x < bounds.left && target.x < bounds.left) ||
        (source.x > bounds.right && target.x > bounds.right) ||
        (source.y < bounds.top && target.y < bounds.top) ||
        (source.y > bounds.bottom && target.y > bounds.bottom)
      ) return;
    }

    const isFocusLink = focusNodeId != null &&
      (String(source.id) === String(focusNodeId) || String(target.id) === String(focusNodeId));
    const linkDimmed = focusNodeId != null && !isFocusLink;

    // Fade each link in alongside its later-appearing endpoint, mirroring the
    // node fade in CustomForceGraph (same duration/stagger constants). Skip the
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

    ctx.save();
    ctx.globalAlpha = fadeAlpha;

    ctx.strokeStyle = isFocusLink
      ? 'rgba(17,24,39,0.9)'
      : (linkDimmed ? 'rgba(17,24,39,0.05)' : 'rgba(17,24,39,0.18)');
    ctx.lineWidth = (isFocusLink ? 2.4 : 1.1) / transform.k;

    const sId = String(sourceId);
    const tId = String(targetId);
    const pairKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
    const pairTotal = edgePairCount.get(pairKey) || 1;
    const pairIdx = edgePairIndex.get(link) || 0;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);

    if (pairTotal > 1) {
      const fanOffset = (pairIdx - (pairTotal - 1) / 2) * 0.1;
      const cpX = (source.x + target.x) / 2 + (target.y - source.y) * fanOffset;
      const cpY = (source.y + target.y) / 2 - (target.x - source.x) * fanOffset;
      ctx.quadraticCurveTo(cpX, cpY, target.x, target.y);
    } else {
      ctx.lineTo(target.x, target.y);
    }

    ctx.stroke();
    ctx.restore();
  });
}
