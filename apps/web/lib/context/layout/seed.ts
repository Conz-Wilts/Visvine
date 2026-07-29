// Stage 2 — INITIALIZE: deterministic starting positions per component
// (PivotMDS, falling back to a phyllotaxis spiral).

import type { Component, Rng } from './types';
import { bfs } from './prepare';

/**
 * Phyllotaxis (sunflower) placement: node i at radius s·√(i+0.5), angle
 * i·golden-angle. Deterministic, uniform-density, collision-free disc — the
 * ideal cheap start for small components. Nodes are placed in BFS order from
 * the highest-degree vertex so context-adjacent nodes start spatially adjacent,
 * which measurably cuts untangling iterations.
 */
export function initPhyllotaxis(comp: Component, K: number): void {
  const n = comp.globals.length;
  // BFS ordering from the max-degree node.
  let start = 0;
  for (let i = 1; i < n; i++) if (comp.degree[i] > comp.degree[start]) start = i;
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);
  bfs(comp, start, dist, queue);
  // `queue` now holds the BFS visit order (component is connected, so all
  // n entries are filled).
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.39996 rad
  const spacing = 0.62 * K; // ring gap ≈ 0.62K ⇒ near ideal-edge density
  for (let k = 0; k < n; k++) {
    const i = queue[k];
    const r = spacing * Math.sqrt(k + 0.5);
    const a = k * GOLDEN_ANGLE;
    comp.px[i] = r * Math.cos(a);
    comp.py[i] = r * Math.sin(a);
  }
}

/**
 * PivotMDS (Brandes & Pich, "Eigensolver Methods for Progressive
 * Multidimensional Scaling of Large Data", GD 2006).
 *
 * Classical MDS recovers coordinates whose pairwise Euclidean distances best
 * match context-theoretic distances (in the least-squares sense of the inner-
 * product matrix) — but needs the full n×n distance matrix. PivotMDS samples
 * k pivot columns instead:
 *
 *   1. pick k pivots (hybrid max-min/k-center + random — pure max-min
 *      over-samples the periphery and degrades, per the paper),
 *   2. BFS from each pivot → Δ ∈ ℕ^{n×k} of hop distances,
 *   3. double-center the squared distances:
 *        C_ij = -½ (δ²_ij − rowMean_i(δ²) − colMean_j(δ²) + grandMean(δ²)),
 *   4. the top-2 left singular vectors of C are the coordinates; obtain them
 *      from the k×k matrix CᵀC by power iteration (cheap), then map back:
 *      x = C·v₁, y = C·v₂ (multiplying by C bakes in the singular values, so
 *      the RELATIVE axis scaling is automatically correct).
 *
 * The ABSOLUTE scale of x = C·v is arbitrary (σ·u, not classical MDS's
 * √λ·u — display normalization absorbs this in the paper, but our force
 * stage needs commensurate units). We therefore anchor the scale
 * empirically: rescale so the component's mean edge length equals K, the
 * force model's natural spring length. Without this the init can land
 * hundreds of K wide and the step-capped integrator cannot contract it
 * within its iteration budget.
 */
export function initPivotMDS(comp: Component, K: number, rng: Rng): boolean {
  const n = comp.globals.length;
  const k = Math.min(64, n);
  const dist = new Int32Array(n);
  const queue = new Int32Array(n);

  // --- pivot selection: first = max-degree, half max-min, half random ---
  const pivots = new Int32Array(k);
  const minDist = new Float64Array(n).fill(Infinity);
  const isPivot = new Uint8Array(n);
  let p0 = 0;
  for (let i = 1; i < n; i++) if (comp.degree[i] > comp.degree[p0]) p0 = i;
  pivots[0] = p0;
  isPivot[p0] = 1;

  // d2[j*n + i] = squared hop distance from pivot j to node i.
  const d2 = new Float64Array(k * n);
  for (let j = 0; j < k; j++) {
    const p = pivots[j];
    bfs(comp, p, dist, queue);
    const row = j * n;
    for (let i = 0; i < n; i++) {
      const d = dist[i]; // component is connected ⇒ d ≥ 0
      d2[row + i] = d * d;
      if (d < minDist[i]) minDist[i] = d;
    }
    if (j + 1 >= k) break;
    // Next pivot: max-min for the first half (good coverage), seeded-random
    // afterwards (avoids the periphery-bias deterioration noted in the paper).
    let next = -1;
    if (j + 1 <= k >> 1) {
      let best = -1;
      for (let i = 0; i < n; i++) {
        if (!isPivot[i] && minDist[i] > best) {
          best = minDist[i];
          next = i;
        }
      }
    } else {
      // Rejection-sample a non-pivot deterministically via the seeded rng.
      for (let tries = 0; tries < 64 && next === -1; tries++) {
        const cand = Math.min(n - 1, Math.floor(rng() * n));
        if (!isPivot[cand]) next = cand;
      }
      if (next === -1) {
        for (let i = 0; i < n; i++)
          if (!isPivot[i]) {
            next = i;
            break;
          }
      }
    }
    if (next === -1) return false; // n < k shouldn't happen (k = min(64, n))
    pivots[j + 1] = next;
    isPivot[next] = 1;
  }

  // --- double centering: C_ij = -½(δ²ij − rowMean_i − colMean_j + grand) ---
  // colMean_j: mean over the n nodes of pivot j's column.
  // rowMean_i: mean over the k pivots for node i.
  const colMean = new Float64Array(k);
  const rowMean = new Float64Array(n);
  let grand = 0;
  for (let j = 0; j < k; j++) {
    const row = j * n;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const v = d2[row + i];
      s += v;
      rowMean[i] += v;
    }
    colMean[j] = s / n;
    grand += s;
  }
  grand /= k * n;
  for (let i = 0; i < n; i++) rowMean[i] /= k;
  // Reuse d2 storage as C (row-major by pivot j for cache-friendly CᵀC).
  for (let j = 0; j < k; j++) {
    const row = j * n;
    const cm = colMean[j];
    for (let i = 0; i < n; i++) {
      d2[row + i] = -0.5 * (d2[row + i] - rowMean[i] - cm + grand);
    }
  }
  const C = d2; // alias: C[j*n + i]

  // --- M = CᵀC (k×k, symmetric), O(k²n) ---
  const M = new Float64Array(k * k);
  for (let a = 0; a < k; a++) {
    const ra = a * n;
    for (let b = a; b < k; b++) {
      const rb = b * n;
      let s = 0;
      for (let i = 0; i < n; i++) s += C[ra + i] * C[rb + i];
      M[a * k + b] = s;
      M[b * k + a] = s;
    }
  }

  // --- top-2 eigenvectors of M by power iteration with deflation ---
  const v1 = powerIterate(M, k, null, rng);
  if (!v1) return false;
  const v2 = powerIterate(M, k, v1, rng);
  if (!v2) return false;

  // --- coordinates: x_i = Σ_j C[j][i]·v_j (raw projection units) ---
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    let y = 0;
    for (let j = 0; j < k; j++) {
      const c = C[j * n + i];
      x += c * v1[j];
      y += c * v2[j];
    }
    comp.px[i] = x;
    comp.py[i] = y;
    varX += x * x;
    varY += y * y;
  }
  // Degenerate spectrum (e.g. star contexts put all leaves at one point):
  // bail to phyllotaxis if there is no usable spread.
  if (!isFinite(varX) || varX < 1e-12) return false;

  // --- anchor the arbitrary projection scale: mean edge length := K ---
  const mEdges = comp.edges.length / 2;
  let totalLen = 0;
  for (let e = 0; e < mEdges; e++) {
    const a = comp.edges[2 * e];
    const b = comp.edges[2 * e + 1];
    totalLen += Math.hypot(comp.px[a] - comp.px[b], comp.py[a] - comp.py[b]);
  }
  const meanLen = totalLen / Math.max(1, mEdges);
  if (!isFinite(meanLen) || meanLen < 1e-12) return false;
  const rescale = K / meanLen;
  for (let i = 0; i < n; i++) {
    comp.px[i] *= rescale;
    comp.py[i] *= rescale;
  }
  // Near-collinear output (paths) is *correct*, but seed a whisker of y-noise
  // so the force stage can fan out immediately instead of fighting symmetry.
  if ((varY / Math.max(varX, 1e-12)) < 1e-6) {
    for (let i = 0; i < n; i++) comp.py[i] += (rng() - 0.5) * 0.05 * K;
  }
  return true;
}

/** Power iteration for the dominant eigenvector of symmetric M (k×k),
 *  deflating against `against` if given. Returns null on degenerate spectrum. */
function powerIterate(
  M: Float64Array,
  k: number,
  against: Float64Array | null,
  rng: Rng,
): Float64Array | null {
  let v = new Float64Array(k);
  for (let i = 0; i < k; i++) v[i] = rng() - 0.5;
  let w = new Float64Array(k);
  for (let iter = 0; iter < 200; iter++) {
    if (against) {
      let dot = 0;
      for (let i = 0; i < k; i++) dot += v[i] * against[i];
      for (let i = 0; i < k; i++) v[i] -= dot * against[i];
    }
    // w = M v
    for (let a = 0; a < k; a++) {
      let s = 0;
      const row = a * k;
      for (let b = 0; b < k; b++) s += M[row + b] * v[b];
      w[a] = s;
    }
    let norm = 0;
    for (let i = 0; i < k; i++) norm += w[i] * w[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-12) return null;
    let align = 0;
    for (let i = 0; i < k; i++) {
      w[i] /= norm;
      align += w[i] * v[i];
    }
    const t = v;
    v = w;
    w = t;
    if (Math.abs(align) > 1 - 1e-12 && iter > 2) break;
  }
  if (against) {
    let dot = 0;
    for (let i = 0; i < k; i++) dot += v[i] * against[i];
    for (let i = 0; i < k; i++) v[i] -= dot * against[i];
    let norm = 0;
    for (let i = 0; i < k; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-9) return null;
    for (let i = 0; i < k; i++) v[i] /= norm;
  }
  return v;
}

/**
 * Structurally-equivalent vertices (e.g. all leaves of a star) receive
 * identical PivotMDS coordinates. Repulsion can't act on a zero vector, so
 * break exact ties with a deterministic whisker of noise.
 */
export function jiggleCoincident(comp: Component, K: number, rng: Rng): void {
  const n = comp.globals.length;
  const seen = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const key = comp.px[i].toFixed(6) + ':' + comp.py[i].toFixed(6);
    const count = seen.get(key) ?? 0;
    if (count > 0) {
      const a = rng() * Math.PI * 2;
      const r = 0.02 * K * (1 + count * 0.25) * (0.5 + rng());
      comp.px[i] += r * Math.cos(a);
      comp.py[i] += r * Math.sin(a);
    }
    seen.set(key, count + 1);
  }
}
