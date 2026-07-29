// Stage 6b — COMPOSE: place each component's local coordinates into the packed
// cloud, then uniformly scale the result into the requested viewport.

import type { Component, PositionedNode, PreparedContext } from './types';
import { type MetaCircle, packCircles } from './pack';

/**
 * Compose per-component layouts (plus isolated singletons) into one organic
 * cloud via force-directed circle packing, then uniformly scale into the
 * viewport. Radii scale together with positions so the zero-overlap
 * guarantee survives normalization exactly.
 */
export function composeLayout(
  comps: Component[],
  isolated: Component[],
  g: PreparedContext,
  opts: {
    width: number;
    height: number;
    padding: number;
    K: number;
    nodeRadius: number;
    nodePadding: number;
    maxUpscale: number;
    componentMargin?: number;
    seed: number;
  },
): {
  nodes: PositionedNode[];
  bounds: { x: number; y: number; width: number; height: number };
  scale: number;
} {
  const { width, height, padding, K, nodePadding, maxUpscale } = opts;
  const margin = opts.componentMargin ?? Math.max(K * 0.75, 24);

  // World-space output positions per global node index.
  const outX = new Float64Array(g.n);
  const outY = new Float64Array(g.n);

  // Each component's bounding circle gets margin/2 of padding, so tangent
  // circles leave a full `margin` of clear space between component contents.
  const circles: MetaCircle[] = [];
  for (const comp of comps) {
    const n = comp.globals.length;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (comp.px[i] < minX) minX = comp.px[i];
      if (comp.px[i] > maxX) maxX = comp.px[i];
      if (comp.py[i] < minY) minY = comp.py[i];
      if (comp.py[i] > maxY) maxY = comp.py[i];
    }
    const cx0 = (minX + maxX) / 2;
    const cy0 = (minY + maxY) / 2;
    let rad = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(comp.px[i] - cx0, comp.py[i] - cy0) + comp.radii[i];
      if (d > rad) rad = d;
    }
    circles.push({
      x: 0,
      y: 0,
      r: rad + margin / 2,
      place(cx: number, cy: number) {
        for (let i = 0; i < n; i++) {
          outX[comp.globals[i]] = comp.px[i] - cx0 + cx;
          outY[comp.globals[i]] = comp.py[i] - cy0 + cy;
        }
      },
    });
  }

  // Isolated nodes join as singleton circles with shelf-tight padding (their
  // neighbours are usually other singles; component margin would read as
  // scattered confetti). packCircles keeps them after the shuffled
  // components, so they fill the cloud's periphery.
  const isoHalfGap = nodePadding * 0.5 + 2;
  for (const c of isolated) {
    const gi = c.globals[0];
    circles.push({
      x: 0,
      y: 0,
      r: c.radii[0] + isoHalfGap,
      place(cx: number, cy: number) {
        outX[gi] = cx;
        outY[gi] = cy;
      },
    });
  }

  packCircles(circles, comps.length, K, opts.seed);
  for (const c of circles) c.place(c.x, c.y);

  // Tight content bounds in world space (including radii).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < g.n; i++) {
    const r = g.radii[i];
    if (outX[i] - r < minX) minX = outX[i] - r;
    if (outX[i] + r > maxX) maxX = outX[i] + r;
    if (outY[i] - r < minY) minY = outY[i] - r;
    if (outY[i] + r > maxY) maxY = outY[i] + r;
  }
  const bw = Math.max(maxX - minX, 1e-6);
  const bh = Math.max(maxY - minY, 1e-6);
  const availW = Math.max(width - 2 * padding, 1);
  const availH = Math.max(height - 2 * padding, 1);
  const scale = Math.min(availW / bw, availH / bh, maxUpscale);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const nodes: PositionedNode[] = new Array(g.n);
  for (let i = 0; i < g.n; i++) {
    nodes[i] = {
      id: g.ids[i],
      x: width / 2 + (outX[i] - cx) * scale,
      y: height / 2 + (outY[i] - cy) * scale,
      r: g.radii[i] * scale,
    };
  }
  return {
    nodes,
    bounds: {
      x: width / 2 - (bw / 2) * scale,
      y: height / 2 - (bh / 2) * scale,
      width: bw * scale,
      height: bh * scale,
    },
    scale,
  };
}
