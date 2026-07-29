// Stage 6a — COMPOSE: force-directed packing of the component bounding
// circles into an organic, roughly circular cloud.

import type { Component } from './types';
import { mulberry32 } from './rng';
import { collidePass } from './collide';

/**
 * A connected component (or isolated node) abstracted as its bounding circle
 * for the composition stage. `place` translates the component's local
 * coordinates so its content center lands at the packed circle center.
 */
export interface MetaCircle {
  x: number;
  y: number;
  r: number;
  place: (cx: number, cy: number) => void;
}

/**
 * Force-directed composition of component circles: seed on a phyllotaxis
 * spiral (radius follows cumulative area ⇒ roughly uniform density), then
 * relax with a proportional pull toward the shared center of gravity against
 * Gauss-Seidel circle collisions, finishing with full-strength separation
 * sweeps until one passes clean. This settles into the organic, compact,
 * roughly circular cloud a force simulation produces — not shelf-packed
 * rows — while keeping the hard no-overlap guarantee (disjoint bounding
 * circles ⇒ no node overlap across components).
 *
 * Placement order is a seeded shuffle of the connected components: any
 * sorted order (the old tallest-first shelf sort especially) lines
 * same-sized components up next to each other, which reads as artificial.
 * Isolated singletons are appended after the shuffle so they seed — and
 * stay — on the periphery, echoing the live simulation's isolated-node ring.
 *
 * Deterministic and idempotent: all randomness flows through a local PRNG
 * re-seeded per call, so progress snapshots (which re-run composition on
 * intermediate positions) never perturb the final result.
 */
export function packCircles(
  circles: MetaCircle[],
  connectedCount: number,
  K: number,
  seed: number,
): void {
  const C = circles.length;
  if (C === 0) return;
  const rng = mulberry32((seed ^ Math.imul(C, 0x9e3779b9)) >>> 0);

  // Seeded Fisher-Yates over the connected components (isolated stay last).
  for (let i = connectedCount - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = circles[i];
    circles[i] = circles[j];
    circles[j] = t;
  }

  // Phyllotaxis seeding with ×1.35 head-room: relaxation then works by
  // compacting inward (which settles cleanly) rather than exploding outward.
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  let cumArea = 0;
  for (let k = 0; k < C; k++) {
    const c = circles[k];
    cumArea += Math.PI * c.r * c.r;
    const R = k === 0 ? 0 : Math.sqrt(cumArea / Math.PI) * 1.35;
    const a = k * GOLDEN_ANGLE;
    c.x = R * Math.cos(a);
    c.y = R * Math.sin(a);
  }
  if (C === 1) return;

  // Meta-"component" so the collision machinery (quadtree + collidePass) is
  // reused verbatim on the circles. Only px/py/radii (and the node count via
  // globals.length) are read on that path; the context fields stay empty.
  const meta: Component = {
    globals: new Int32Array(C),
    edges: new Int32Array(0),
    adjOffsets: new Int32Array(C + 1),
    adjTargets: new Int32Array(0),
    degree: new Int32Array(C),
    radii: new Float64Array(C),
    px: new Float64Array(C),
    py: new Float64Array(C),
  };
  const mass = new Float64Array(C);
  for (let i = 0; i < C; i++) {
    meta.px[i] = circles[i].x;
    meta.py[i] = circles[i].y;
    meta.radii[i] = circles[i].r;
    mass[i] = circles[i].r * circles[i].r;
  }

  // Relax: gravity strong → gentle while collision strength ramps gentle →
  // full. Gravity is a proportional contraction toward the origin (where the
  // spiral is centered), so the cloud compacts until collisions hold it open.
  const relaxIters = C > 1500 ? 24 : 64;
  for (let t = 0; t < relaxIters; t++) {
    const g = 0.012 + 0.08 * (1 - t / relaxIters);
    for (let i = 0; i < C; i++) {
      meta.px[i] *= 1 - g;
      meta.py[i] *= 1 - g;
    }
    collidePass(meta, mass, rng, K, 0, Math.min(1, 0.5 + t / relaxIters));
  }

  // Hard guarantee: full-strength sweeps until one finds nothing to resolve.
  // The periodic radial inflation is the escape valve that makes termination
  // certain (positions scale, radii don't, so any residual jam loosens).
  for (let sweep = 0; sweep < 400; sweep++) {
    if (collidePass(meta, mass, rng, K, 0, 1) === 0) break;
    if ((sweep + 1) % 80 === 0) {
      for (let i = 0; i < C; i++) {
        meta.px[i] *= 1.04;
        meta.py[i] *= 1.04;
      }
    }
  }

  for (let i = 0; i < C; i++) {
    circles[i].x = meta.px[i];
    circles[i].y = meta.py[i];
  }
}
