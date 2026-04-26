/**
 * Link renderer for graph connections
 * Flow-aware curves with multi-edge fan for parallel edges
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

/**
 * Draw all links between nodes with flow-aware curves and multi-edge fan
 */
export function drawLinks(
  ctx: CanvasRenderingContext2D,
  links: SimLink[],
  nodes: SimNode[],
  transform: Transform,
  focusNodeId: string | null
): void {
  // Build connection map for flow analysis
  const nodeConnections = new Map<string, Array<{ nodeId: string, x: number, y: number }>>();

  // Count parallel edges between same node pairs
  const edgePairCount = new Map<string, number>();
  const edgePairIndex = new Map<SimLink, number>();

  links.forEach(link => {
    const sourceId = String(typeof link.source === 'string' ? link.source : (link.source as SimNode).id);
    const targetId = String(typeof link.target === 'string' ? link.target : (link.target as SimNode).id);
    const pairKey = sourceId < targetId ? `${sourceId}|${targetId}` : `${targetId}|${sourceId}`;
    const idx = edgePairCount.get(pairKey) || 0;
    edgePairCount.set(pairKey, idx + 1);
    edgePairIndex.set(link, idx);

    const source = typeof link.source === 'string'
      ? nodes.find(n => String(n.id) === sourceId) : link.source as SimNode;
    const target = typeof link.target === 'string'
      ? nodes.find(n => String(n.id) === targetId) : link.target as SimNode;

    if (source?.x && source?.y && target?.x && target?.y) {
      if (!nodeConnections.has(sourceId)) nodeConnections.set(sourceId, []);
      if (!nodeConnections.has(targetId)) nodeConnections.set(targetId, []);
      nodeConnections.get(sourceId)!.push({ nodeId: targetId, x: target.x, y: target.y });
      nodeConnections.get(targetId)!.push({ nodeId: sourceId, x: source.x, y: source.y });
    }
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
      ? 'rgba(17,24,39,0.85)'
      : (linkDimmed ? 'rgba(17,24,39,0.06)' : 'rgba(17,24,39,0.2)');
    ctx.lineWidth = (isFocusLink ? 2 : 1.2) / transform.k;

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const edgeLength = Math.sqrt(dx * dx + dy * dy);

    // Multi-edge fan: spread parallel edges
    const sId = String(sourceId);
    const tId = String(targetId);
    const pairKey = sId < tId ? `${sId}|${tId}` : `${tId}|${sId}`;
    const pairTotal = edgePairCount.get(pairKey) || 1;
    const pairIdx = edgePairIndex.get(link) || 0;
    const fanOffset = pairTotal > 1 ? (pairIdx - (pairTotal - 1) / 2) * 0.08 : 0;

    const sourceConnections = nodeConnections.get(String(source.id)) || [];
    const targetConnections = nodeConnections.get(String(target.id)) || [];
    const isSourceLeaf = sourceConnections.length === 1;
    const isTargetLeaf = targetConnections.length === 1;

    let curvature: number;

    if (isSourceLeaf || isTargetLeaf) {
      curvature = Math.min(edgeLength * 0.0003, 0.05) + fanOffset;
    } else {
      let curvatureMultiplier = 1;
      let useMinimalCurve = false;
      const angles: number[] = [];

      sourceConnections.forEach(conn => {
        if (conn.nodeId !== String(target.id)) {
          const connConns = nodeConnections.get(conn.nodeId) || [];
          if (connConns.length > 1) {
            angles.push(Math.atan2(conn.y - source.y!, conn.x - source.x!));
          }
        }
      });

      targetConnections.forEach(conn => {
        if (conn.nodeId !== String(source.id)) {
          const connConns = nodeConnections.get(conn.nodeId) || [];
          if (connConns.length > 1) {
            angles.push(Math.atan2(conn.y - target.y!, conn.x - target.x!));
          }
        }
      });

      if (angles.length > 0) {
        const edgeAngle = Math.atan2(dy, dx);
        const angleDiffs = angles.map(a => {
          let diff = Math.abs(a - edgeAngle);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          return diff;
        });
        const avgDiff = angleDiffs.reduce((sum, d) => sum + d, 0) / angleDiffs.length;

        if (avgDiff < Math.PI / 6) {
          useMinimalCurve = true;
        } else {
          const crossProducts = angles.map(a => dx * Math.sin(a) - dy * Math.cos(a));
          const avgCross = crossProducts.reduce((sum, c) => sum + c, 0) / crossProducts.length;
          curvatureMultiplier = Math.sign(avgCross) || 1;
        }
      }

      curvature = useMinimalCurve
        ? 0.02 + fanOffset
        : Math.min(edgeLength * 0.0006, 0.12) * curvatureMultiplier + fanOffset;
    }

    const cpX = (source.x + target.x) / 2 + (target.y - source.y) * curvature;
    const cpY = (source.y + target.y) / 2 - (target.x - source.x) * curvature;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.quadraticCurveTo(cpX, cpY, target.x, target.y);
    ctx.stroke();
  });
}
