// Stage 3 — REFINE: Yifan Hu spring-electrical force simulation with
// ForceAtlas2-style degree-weighted repulsion, run as a generator so the async
// driver can yield between iterations.

import type { Component, Rng } from './types';
import { QT_EMPTY, QT_MAX_DEPTH, buildQuadtree } from './quadtree';
import { collidePass } from './collide';
import { applyNodeEdgeRepulsion } from './crossings';
import { now } from './rng';

/**
 * Spring-electrical force model, Yifan Hu (GD 2005) with ForceAtlas2-style
 * degree masses:
 *
 *   attraction along edges:  F_a(d) = d²/K             (toward the neighbor)
 *   repulsion between nodes: F_r(d) = C·K³·mᵤ·mᵥ / d²  (away), m = deg+1
 *   gravity per node:        F_g    = g·K·mᵤ           (toward the centroid)
 *
 * The 1/d² repulsion is Hu's "general model" with exponent p = 2 (Graphviz's
 * `repulsiveforce`): shorter-range than the classic 1/d, which Hu recommends
 * precisely because long-range 1/d pressure warps the periphery of sparse
 * structures — an n-cycle inflates to ~3× its natural radius under p = 1
 * (every pair contributes a constant outward radial force), while under
 * p = 2 distant pairs decay and a 40-cycle settles at its natural circle.
 * Constant-magnitude mass-proportional gravity (ForceAtlas2's k_g·(deg+1),
 * ramped to zero inside 0.5K of the centroid to avoid a discontinuity)
 * supplies the remaining compaction. Equilibrium for an isolated edge of
 * deg-1 nodes: d⁴ ≈ C·K⁴·4 ⇒ d ≈ 0.95K, and ≈ 0.87K with default gravity.
 *
 * The (deg+1)(deg+1) mass product (ForceAtlas2's signature) makes hub
 * neighborhoods claim area proportional to their degree, so leaf fans spread
 * into rings instead of crushing into the hub — the classic hub pathology.
 *
 * Integration is Hu's normalized scheme: each node moves exactly `step`
 * along its net force direction; an energy-based controller adapts `step`:
 * five consecutive energy decreases ⇒ step /= 0.9 (accelerate), any energy
 * increase ⇒ step *= 0.9 (back off). Convergence when step < 0.01·K — since
 * every node moves exactly `step`, the step IS the per-node movement bound.
 *
 * One refinement over Hu: per-node oscillation damping (a cheap stand-in for
 * ForceAtlas2's swinging/traction machinery). A node whose net force reversed
 * direction since the last sweep (negative dot product) is oscillating around
 * its equilibrium, so it moves at half step. This kills the shimmer Hu's
 * uniform step causes in converged regions while distant regions still move.
 *
 * Barnes-Hut opening criterion: cellWidth / distance ≤ θ (θ = 1.1) — O(n log n).
 */
export interface ForceConfig {
  K: number;
  rng: Rng;
  deadline: number;
  plannedIters: number;
  collideIters: number;
  nodePadding: number;
  gravity: number;
  /** Enable PrEd node-edge repulsion in the last iterations (small contexts). */
  nodeEdgeRepulsion: boolean;
}

/**
 * Generator so the async driver can yield to the event loop mid-simulation:
 * yields (no value) every few iterations; returns the iteration count.
 * The sync driver simply drains it.
 */
export function* runForces(comp: Component, cfg: ForceConfig): Generator<void, number> {
  const n = comp.globals.length;
  if (n < 2) return 0;
  const { K, rng } = cfg;
  const C_REP = 0.2; // Hu's experimentally recommended repulsion constant
  const THETA = 1.1;
  const THETA2 = THETA * THETA;
  const MIN_D2 = 0.01 * K * K; // (0.1K)² — caps repulsion singularities

  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const prevFx = new Float64Array(n);
  const prevFy = new Float64Array(n);
  const nodeMass = new Float64Array(n);
  for (let i = 0; i < n; i++) nodeMass[i] = comp.degree[i] + 1;

  const stack = new Int32Array(QT_MAX_DEPTH * 4 + 8);
  const m = comp.edges.length / 2;

  let step = 0.3 * K; // good init ⇒ start gentle; the controller adapts fast
  const maxStep = K;
  let energyPrev = Infinity;
  let progress = 0;
  const T_COOL = 0.9;

  const totalIters = cfg.plannedIters + cfg.collideIters;
  const collideStart = cfg.plannedIters;
  const predStart = cfg.nodeEdgeRepulsion
    ? Math.max(collideStart, totalIters - 12)
    : Infinity;

  let iter = 0;
  for (; iter < totalIters; iter++) {
    if ((iter & 3) === 0 && now() > cfg.deadline && iter >= 8) break;
    // Hand control back to the driver periodically (event-loop breathing
    // room + progressive snapshots for the async path).
    if (iter > 0 && iter % 10 === 0) yield;

    const qt = buildQuadtree(n, comp.px, comp.py, comp.radii, nodeMass, rng, K);
    fx.fill(0);
    fy.fill(0);

    // --- Barnes-Hut repulsion ---
    for (let i = 0; i < n; i++) {
      let sumX = 0;
      let sumY = 0;
      let top = 0;
      stack[top++] = 0;
      while (top > 0) {
        const c = stack[--top];
        const dx = comp.px[i] - qt.comX[c];
        const dy = comp.py[i] - qt.comY[c];
        let d2 = dx * dx + dy * dy;
        const width = 2 * qt.half[c];
        if (width * width <= THETA2 * d2) {
          if (d2 < MIN_D2) d2 = MIN_D2;
          // p = 2 repulsion: |F| ∝ m/d² along Δ/d ⇒ vector = Δ·m/d³
          const w = qt.mass[c] / (d2 * Math.sqrt(d2));
          sumX += dx * w;
          sumY += dy * w;
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const v = qt.children[4 * c + q];
          if (v === QT_EMPTY) continue;
          if (v < QT_EMPTY) {
            const j = -v - 2;
            if (j === i) continue;
            const djx = comp.px[i] - comp.px[j];
            const djy = comp.py[i] - comp.py[j];
            let dj2 = djx * djx + djy * djy;
            if (dj2 < MIN_D2) dj2 = MIN_D2;
            const wj = nodeMass[j] / (dj2 * Math.sqrt(dj2));
            sumX += djx * wj;
            sumY += djy * wj;
          } else {
            stack[top++] = v;
          }
        }
      }
      const scale = C_REP * K * K * K * nodeMass[i];
      fx[i] += scale * sumX;
      fy[i] += scale * sumY;
    }

    // --- mass-proportional gravity toward the component centroid ---
    // The quadtree root's center of mass is the (mass-weighted) centroid,
    // available for free. Magnitude ramps linearly to zero inside 0.5K so
    // the constant-force field has no discontinuity at the center.
    if (cfg.gravity > 0) {
      const gx = qt.comX[0];
      const gy = qt.comY[0];
      for (let i = 0; i < n; i++) {
        const dx = gx - comp.px[i];
        const dy = gy - comp.py[i];
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-9) continue;
        const ramp = Math.min(1, d / (0.5 * K));
        const mag = (cfg.gravity * K * nodeMass[i] * ramp) / d;
        fx[i] += dx * mag;
        fy[i] += dy * mag;
      }
    }

    // --- spring attraction along edges: F = Δ·(d/K) toward the neighbor ---
    for (let e = 0; e < m; e++) {
      const a = comp.edges[2 * e];
      const b = comp.edges[2 * e + 1];
      const dx = comp.px[b] - comp.px[a];
      const dy = comp.py[b] - comp.py[a];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 1e-12) continue;
      const w = d / K; // |F| = d²/K applied along Δ/d
      fx[a] += dx * w;
      fy[a] += dy * w;
      fx[b] -= dx * w;
      fy[b] -= dy * w;
    }

    // --- PrEd node-edge repulsion (final iterations, small components) ---
    if (iter >= predStart) {
      applyNodeEdgeRepulsion(comp, fx, fy, K);
    }

    // --- normalized movement with per-node oscillation damping ---
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const fxi = fx[i];
      const fyi = fy[i];
      const f2 = fxi * fxi + fyi * fyi;
      energy += f2;
      if (f2 < 1e-18) continue;
      const f = Math.sqrt(f2);
      const oscillating = fxi * prevFx[i] + fyi * prevFy[i] < 0;
      const s = oscillating ? step * 0.5 : step;
      comp.px[i] += (fxi / f) * s;
      comp.py[i] += (fyi / f) * s;
      prevFx[i] = fxi;
      prevFy[i] = fyi;
    }

    // --- collision relaxation rides along in the final phase ---
    if (iter >= collideStart) {
      const t = (iter - collideStart + 1) / Math.max(1, cfg.collideIters);
      collidePass(comp, nodeMass, rng, K, cfg.nodePadding, 0.5 + 0.5 * t);
    }

    // --- Hu's adaptive step controller (verbatim from the paper, t = 0.9) ---
    if (energy < energyPrev) {
      progress++;
      if (progress >= 5) {
        progress = 0;
        step = Math.min(step / T_COOL, maxStep);
      }
    } else {
      progress = 0;
      step *= T_COOL;
    }
    energyPrev = energy;

    // Converged? Skip ahead to the collision phase rather than spinning.
    if (step < 0.01 * K) {
      if (iter < collideStart) {
        iter = collideStart - 1; // for-loop ++ lands on collideStart
        step = 0.05 * K; // small headroom for collision re-equilibration
        continue;
      }
      break;
    }
  }
  return iter;
}
