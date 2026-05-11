/**
 * Link renderer for graph connections.
 * Straight lines by default; gentle fan-out only when multiple edges share
 * the same pair of endpoints, so they don't visually merge.
 */

import { NBNode } from '@/lib/types';

interface SimNode extends NBNode {
  x?: number;
  y?: number;
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

export function drawLinks(
  ctx: CanvasRenderingContext2D,
  links: SimLink[],
  nodes: SimNode[],
  transform: Transform,
  focusNodeId: string | null
): void {
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
      ? nodes.find(n => String(n.id) === sourceId) : link.source as SimNode;
    const target = typeof link.target === 'string'
      ? nodes.find(n => String(n.id) === targetId) : link.target as SimNode;

    if (!source?.x || !target?.x || typeof source.y !== 'number' || typeof target.y !== 'number') return;

    const isFocusLink = focusNodeId != null &&
      (String(source.id) === String(focusNodeId) || String(target.id) === String(focusNodeId));
    const linkDimmed = focusNodeId != null && !isFocusLink;

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
  });
}
