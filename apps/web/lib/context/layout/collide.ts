// Stage 4 — SEPARATE: soft circle-collision relaxation during the force run,
// then a scan-line stacking pass that provably leaves zero node-node overlap.

import type { Component, PositionedNode, Rng } from './types';
import { QT_EMPTY, QT_MAX_DEPTH, buildQuadtree } from './quadtree';

/**
 * One Gauss-Seidel circle-collision sweep (d3-forceCollide style):
 * for every overlapping pair, displace both nodes apart along the center
 * line, split by mass (r²) so small nodes yield. `strength` < 1 blends
 * simultaneous corrections to avoid the classic alternating-overshoot
 * shimmer. Pairs are visited once via the leaf-ordering trick (j > i).
 */
export function collidePass(
  comp: Component,
  nodeMass: Float64Array,
  rng: Rng,
  K: number,
  pad: number,
  strength: number,
): number {
  const n = comp.globals.length;
  const qt = buildQuadtree(n, comp.px, comp.py, comp.radii, nodeMass, rng, K);
  const stack = new Int32Array(QT_MAX_DEPTH * 4 + 8);
  let resolved = 0;
  for (let i = 0; i < n; i++) {
    const ri = comp.radii[i] + pad / 2;
    let top = 0;
    stack[top++] = 0;
    while (top > 0) {
      const c = stack[--top];
      const reach = ri + qt.maxR[c] + pad / 2;
      if (
        Math.abs(comp.px[i] - qt.cx[c]) > qt.half[c] + reach ||
        Math.abs(comp.py[i] - qt.cy[c]) > qt.half[c] + reach
      ) {
        continue;
      }
      for (let q = 0; q < 4; q++) {
        const v = qt.children[4 * c + q];
        if (v === QT_EMPTY) continue;
        if (v < QT_EMPTY) {
          const j = -v - 2;
          if (j <= i) continue; // each unordered pair exactly once
          const rj = comp.radii[j] + pad / 2;
          let dx = comp.px[j] - comp.px[i];
          let dy = comp.py[j] - comp.py[i];
          let d2 = dx * dx + dy * dy;
          const rr = ri + rj;
          if (d2 >= rr * rr) continue;
          if (d2 < 1e-12) {
            const a = rng() * Math.PI * 2;
            dx = Math.cos(a) * 1e-6;
            dy = Math.sin(a) * 1e-6;
            d2 = 1e-12;
          }
          const d = Math.sqrt(d2);
          const push = ((rr - d) / d) * strength;
          // mass split by squared radius: each node's displacement is
          // weighted by the OTHER node's r², so big nodes hold their ground
          // (d3-forceCollide semantics — j moves a lot only when i is heavy)
          const wj = (ri * ri) / (ri * ri + rj * rj);
          comp.px[j] += dx * push * wj;
          comp.py[j] += dy * push * wj;
          comp.px[i] -= dx * push * (1 - wj);
          comp.py[i] -= dy * push * (1 - wj);
          resolved++;
        } else {
          stack[top++] = v;
        }
      }
    }
  }
  return resolved;
}

/**
 * Guaranteed overlap elimination: scan-line circle stacking.
 *
 * Process nodes in ascending-y order; each node may only be pushed DOWN
 * (+y) until it clears every already-placed node. For a placed node u with
 * |x_u − x_v| < r_u + r_v + gap, clearance requires
 *     y_v ≥ y_u + √((r_u+r_v+gap)² − (x_u−x_v)²).
 * Earlier nodes never move again, pushes are monotone, so by induction the
 * result has ZERO overlapping pairs — a hard guarantee the soft collision
 * passes can't give. x-coordinates and the vertical order are preserved, so
 * post-collide layouts are distorted minimally (usually not at all: a
 * non-overlapping input passes through unchanged).
 *
 * x-bucketing keeps each query local: O(n · local density).
 */
export function stackingPass(comp: Component, pad: number): void {
  const n = comp.globals.length;
  if (n < 2) return;
  let maxR = 0;
  for (let i = 0; i < n; i++) if (comp.radii[i] > maxR) maxR = comp.radii[i];
  const bucketW = Math.max(2 * maxR + pad, 1e-6);
  let minX = Infinity;
  for (let i = 0; i < n; i++) if (comp.px[i] < minX) minX = comp.px[i];

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => comp.py[a] - comp.py[b] || comp.px[a] - comp.px[b] || a - b,
  );
  const buckets = new Map<number, number[]>();
  let totalShift = 0;
  for (const v of order) {
    const rv = comp.radii[v] + pad / 2;
    const reach = rv + maxR + pad / 2;
    const b0 = Math.floor((comp.px[v] - reach - minX) / bucketW);
    const b1 = Math.floor((comp.px[v] + reach - minX) / bucketW);
    let yMin = comp.py[v];
    for (let b = b0; b <= b1; b++) {
      const list = buckets.get(b);
      if (!list) continue;
      for (const u of list) {
        const ru = comp.radii[u] + pad / 2;
        const rr = ru + rv;
        const dx = comp.px[u] - comp.px[v];
        if (Math.abs(dx) >= rr) continue;
        const need = comp.py[u] + Math.sqrt(rr * rr - dx * dx);
        if (need > yMin) yMin = need;
      }
    }
    totalShift += yMin - comp.py[v];
    comp.py[v] = yMin;
    const bv = Math.floor((comp.px[v] - minX) / bucketW);
    let list = buckets.get(bv);
    if (!list) buckets.set(bv, (list = []));
    list.push(v);
  }
  // Re-center vertically so the (downward-only) pushes don't bias the box.
  if (totalShift > 0) {
    const shift = totalShift / n;
    for (let i = 0; i < n; i++) comp.py[i] -= shift;
  }
}

/** Final-layout overlap verification via a uniform grid (O(n·density)). */
export function countOverlaps(nodes: PositionedNode[]): number {
  const n = nodes.length;
  if (n < 2) return 0;
  let maxR = 0;
  for (const nd of nodes) if (nd.r > maxR) maxR = nd.r;
  const cell = Math.max(2 * maxR, 1e-6);
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) =>
    Math.floor(y / cell) * 1048576 + Math.floor(x / cell);
  for (let i = 0; i < n; i++) {
    const k = key(nodes[i].x, nodes[i].y);
    let list = grid.get(k);
    if (!list) grid.set(k, (list = []));
    list.push(i);
  }
  let overlaps = 0;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(nodes[i].x / cell);
    const cy = Math.floor(nodes[i].y / cell);
    for (let by = cy - 1; by <= cy + 1; by++) {
      for (let bx = cx - 1; bx <= cx + 1; bx++) {
        const list = grid.get(by * 1048576 + bx);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const rr = nodes[i].r + nodes[j].r;
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          if (dx * dx + dy * dy < rr * rr - 1e-9) overlaps++;
        }
      }
    }
  }
  return overlaps;
}
