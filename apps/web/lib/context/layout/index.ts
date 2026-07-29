/**
 * A self-contained context layout engine.
 *
 * Produces an organic, force-context-style layout with zero node-node overlap,
 * aggressive edge-crossing reduction, and a hard wall-clock budget so the
 * first visually-complete layout is available well inside 3 seconds.
 *
 * No dependencies. Pure TypeScript, runs in browsers, Web Workers, and Node.
 *
 * Pipeline (each stage is the budget-optimal pick from the context-drawing
 * literature; citations inline at each implementation):
 *
 *   1. DECOMPOSE   union-find connected components; isolated nodes are pulled
 *                  out of the simulation entirely and rejoin as singleton
 *                  circles on the periphery during composition.
 *   2. INITIALIZE  PivotMDS (Brandes & Pich, GD'06) per component — a sparse
 *                  classical-MDS approximation that gives deterministic,
 *                  globally-untangled starting positions in O(k(n+m) + k²n).
 *   3. REFINE      Barnes-Hut force simulation: Yifan Hu's spring-electrical
 *                  model (GD'05) with ForceAtlas2-style degree-weighted
 *                  repulsion masses (Jacomy et al., PLoS ONE 2014) and Hu's
 *                  adaptive step-length schedule; per-node oscillation damping.
 *   4. SEPARATE    soft circle-collision passes (d3-forceCollide-style
 *                  Gauss-Seidel relaxation) inside the last force iterations,
 *                  then a deterministic scan-line stacking pass that provably
 *                  leaves ZERO node-node overlap.
 *   5. POLISH      time-permitting: PrEd-style node-edge repulsion (Bertault,
 *                  GD'00) and greedy vertex-move crossing reduction with
 *                  shrinking-square candidate sampling (Demel et al., GD'18 /
 *                  Radermacher & Rutter, ESA'19), driven by a uniform-grid
 *                  segment index.
 *   6. COMPOSE     force-directed packing of component bounding circles —
 *                  phyllotaxis seeding in seeded-shuffled order, then
 *                  center-gravity + circle-collision relaxation — into an
 *                  organic, roughly circular cloud, then uniform scaling
 *                  into the requested viewport.
 *
 * Determinism: every random draw flows through one seeded mulberry32 PRNG,
 * seeded from a stable FNV-1a hash of the node ids (or options.seed). The
 * algorithm itself is fully deterministic; the only nondeterminism source is
 * the wall-clock time budget. Concretely: when a run finishes WITHOUT
 * tripping its deadlines (stats.budgetExceeded === false), the same input
 * always produces the same layout — cacheable and screenshot-regression-
 * testable. A budget-truncated run stops at a machine-load-dependent
 * iteration and may differ run-to-run; check stats.budgetExceeded before
 * caching, or raise timeBudgetMs for reproducibility-critical paths.
 *
 * Each numbered stage above lives in its own module; this file is the public
 * API plus the pipeline driver that sequences them against the time budget.
 */

import type {
  ContextEdgeInput,
  ContextNodeInput,
  LayoutEdgeOutput,
  LayoutOptions,
  LayoutResult,
  LayoutSnapshot,
  LayoutStats,
} from './types';
import { fnv1a, mulberry32, now, yieldToEventLoop } from './rng';
import { buildComponents, connectedComponents, prepareContext } from './prepare';
import { initPhyllotaxis, initPivotMDS, jiggleCoincident } from './seed';
import { type ForceConfig, runForces } from './forces';
import { collidePass, countOverlaps, stackingPass } from './collide';
import { buildSegGrid, countComponentCrossings, reduceCrossings } from './crossings';
import { composeLayout } from './compose';

export type {
  ContextEdgeInput,
  ContextNodeInput,
  LayoutOptions,
  LayoutResult,
} from './types';

/** Synchronous layout. Returns within ~timeBudgetMs (default 2500 ms). */
export function layoutContext(
  nodes: ContextNodeInput[],
  edges: ContextEdgeInput[],
  options: LayoutOptions = {},
): LayoutResult {
  const gen = layoutPipeline(nodes, edges, options);
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

/**
 * Asynchronous layout: yields to the event loop between work chunks (via
 * requestAnimationFrame in browsers, setTimeout elsewhere) so the UI thread
 * never blocks, and emits paintable intermediate snapshots through
 * options.onProgress. The first snapshot (a globally-untangled PivotMDS
 * approximation) typically arrives within a few hundred ms even for large
 * contexts — this is the "visually complete approximation" for the 3 s SLA.
 */
export async function layoutContextAsync(
  nodes: ContextNodeInput[],
  edges: ContextEdgeInput[],
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const gen = layoutPipeline(nodes, edges, options);
  const onProgress = options.onProgress;
  let lastEmit = now();
  let step = gen.next();
  while (!step.done) {
    const ev = step.value;
    // Emit at most ~8 snapshots/sec; building a snapshot costs O(n).
    if (onProgress && (now() - lastEmit > 120 || ev.forceEmit)) {
      onProgress(ev.makeSnapshot());
      lastEmit = now();
    }
    await yieldToEventLoop();
    step = gen.next();
  }
  return step.value;
}

/* ============================ Pipeline driver ============================ */

interface ProgressEvent {
  makeSnapshot: () => LayoutSnapshot;
  forceEmit: boolean;
}

const EMPTY_STATS = (): LayoutStats => ({
  elapsedMs: 0,
  forceIterations: 0,
  componentCount: 0,
  isolatedCount: 0,
  overlapPairs: 0,
  edgeCrossings: 0,
  crossingsRemoved: 0,
  scale: 1,
  budgetExceeded: false,
  phaseMs: { prepare: 0, initialize: 0, forces: 0, overlap: 0, crossings: 0, compose: 0 },
});

function* layoutPipeline(
  nodesIn: ContextNodeInput[],
  edgesIn: ContextEdgeInput[],
  options: LayoutOptions,
): Generator<ProgressEvent, LayoutResult> {
  const width = options.width ?? 1200;
  const height = options.height ?? 800;
  const padding = options.padding ?? 32;
  const nodeRadius = options.nodeRadius ?? 8;
  const nodePadding = options.nodePadding ?? 4;
  const budget = options.timeBudgetMs ?? 2500;
  const refineCrossings = options.refineCrossings ?? true;
  const maxUpscale = options.maxUpscale ?? 1.25;
  const gravity = options.gravity ?? 0.15;

  const t0 = now();
  const stats = EMPTY_STATS();
  const echoEdges: LayoutEdgeOutput[] = edgesIn.map((e) => ({
    source: e.source,
    target: e.target,
  }));

  /* ---------------- prepare ---------------- */
  const g = prepareContext(nodesIn, edgesIn, nodeRadius);
  if (g.n === 0) {
    return {
      nodes: [],
      edges: echoEdges,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      stats,
    };
  }
  // Ideal edge length: explicit option, else derived from actual node sizes.
  // Two adjacent circles need ≥ r_u + r_v between centers; without headroom
  // proportional to radius, springs (pulling toward K) and collision passes
  // (pushing to ≥ 2r̄) fight each other and edges thread through nodes.
  let meanR = 0;
  for (let i = 0; i < g.n; i++) meanR += g.radii[i];
  meanR /= g.n;
  const rawK =
    options.idealEdgeLength ??
    Math.max(48, 5 * nodeRadius, 3.2 * meanR + nodePadding);
  // K = 0 (or NaN) would zero the phyllotaxis spacing AND the quadtree's
  // coincident-point jiggle, hanging the insert loop — clamp hard.
  const K = Number.isFinite(rawK) && rawK > 1e-6 ? rawK : 48;

  // Seed: explicit option, else a stable hash of the node identity set
  // (NUL-joined so distinct id lists cannot collide at boundaries).
  const seedStr =
    options.seed !== undefined
      ? String(options.seed)
      : g.ids.map(String).join('\u0000');
  const seedHash = fnv1a(seedStr);
  const rng = mulberry32(seedHash ^ 0x9e3779b9);

  const roots = connectedComponents(g);
  const allComps = buildComponents(g, roots);
  const isolated = allComps.filter((c) => c.globals.length === 1);
  const comps = allComps.filter((c) => c.globals.length > 1);
  stats.componentCount = allComps.length;
  stats.isolatedCount = isolated.length;
  stats.phaseMs.prepare = now() - t0;

  /* -------- snapshot machinery: quick pack + normalize of current -------- */
  const buildSnapshot = (
    phase: LayoutSnapshot['phase'],
    progress: number,
  ): LayoutSnapshot => {
    const placed = composeLayout(
      comps,
      isolated,
      g,
      { width, height, padding, K, nodeRadius, nodePadding, maxUpscale, componentMargin: options.componentMargin, seed: seedHash },
    );
    return { nodes: placed.nodes, phase, progress };
  };
  const progressEvent = (
    phase: LayoutSnapshot['phase'],
    progress: number,
    forceEmit = false,
  ): ProgressEvent => ({
    makeSnapshot: () => buildSnapshot(phase, progress),
    forceEmit,
  });

  /* ---------------- initialize ---------------- */
  const tInit = now();
  for (const comp of comps) {
    const n = comp.globals.length;
    if (n === 2) {
      comp.px[0] = -0.47 * K;
      comp.px[1] = 0.47 * K;
      comp.py[0] = comp.py[1] = 0;
      continue;
    }
    let ok = false;
    if (n >= 40) ok = initPivotMDS(comp, K, rng);
    if (!ok) initPhyllotaxis(comp, K);
    jiggleCoincident(comp, K, rng);
  }
  stats.phaseMs.initialize = now() - tInit;
  // First paintable approximation: globally untangled, pre-refinement.
  yield progressEvent('initialize', 0.15, true);

  /* ---------------- force refinement ---------------- */
  const tForce = now();
  const forceDeadline = t0 + budget * 0.72;
  const totalNodes = comps.reduce((s, c) => s + c.globals.length, 0) || 1;
  let done = 0;
  for (const comp of comps) {
    const n = comp.globals.length;
    if (n < 2) continue;
    // Iteration schedule by size; the deadline trims it when needed.
    const planned = n <= 100 ? 300 : n <= 500 ? 240 : n <= 1500 ? 180 : n <= 4000 ? 140 : 100;
    const collideIters = Math.max(20, Math.round(planned * 0.45));
    // Per-component deadline proportional to its share of remaining work.
    const remainingMs = forceDeadline - now();
    const share = n / Math.max(1, totalNodes - done);
    const deadline = now() + Math.max(40, remainingMs * share);
    const m = comp.edges.length / 2;
    const cfg: ForceConfig = {
      K,
      rng,
      deadline: Math.min(deadline, forceDeadline),
      plannedIters: Math.round(planned * 0.55),
      collideIters,
      nodePadding,
      gravity,
      nodeEdgeRepulsion: refineCrossings && m <= 2500,
    };
    const forceGen = runForces(comp, cfg);
    let st = forceGen.next();
    while (!st.done) {
      yield progressEvent('forces', 0.15 + 0.55 * (done / totalNodes));
      st = forceGen.next();
    }
    const iters = st.value;
    stats.forceIterations += iters;
    if (now() > forceDeadline && iters < planned) stats.budgetExceeded = true;
    done += n;
    yield progressEvent('forces', 0.15 + 0.55 * (done / totalNodes));
  }
  stats.phaseMs.forces = now() - tForce;

  /* ---------------- crossing reduction (time-permitting) ---------------- */
  const tCross = now();
  const crossDeadline = t0 + budget * 0.9;
  if (refineCrossings) {
    if (now() < t0 + budget * 0.75) {
      for (const comp of comps) {
        if (now() > crossDeadline) break;
        if (comp.edges.length / 2 > 4000) continue; // out of heuristic's depth
        stats.crossingsRemoved += reduceCrossings(
          comp,
          K,
          nodePadding,
          rng,
          crossDeadline,
        );
      }
      yield progressEvent('crossings', 0.8);
    }
    // Whether the pass was skipped or cut short, time-truncated refinement
    // means this run is not byte-reproducible — flag it for cacheability.
    if (now() > crossDeadline) stats.budgetExceeded = true;
  }
  stats.phaseMs.crossings = now() - tCross;

  /* ---------------- hard overlap guarantee ---------------- */
  const tOverlap = now();
  for (const comp of comps) {
    // A couple of full-strength collide sweeps tidy up anything the in-loop
    // relaxation or vertex moves left, then stacking guarantees zero overlap.
    const nodeMass = new Float64Array(comp.globals.length);
    for (let i = 0; i < nodeMass.length; i++) nodeMass[i] = comp.degree[i] + 1;
    for (let r = 0; r < 3; r++) {
      const resolved = collidePass(comp, nodeMass, rng, K, nodePadding, 1.0);
      if (resolved === 0) break;
    }
    stackingPass(comp, nodePadding * 0.9);
  }
  stats.phaseMs.overlap = now() - tOverlap;
  yield progressEvent('overlap', 0.9);

  /* ---------------- compose: pack components + normalize ---------------- */
  yield progressEvent('compose', 0.95, true);
  const tCompose = now();
  const placed = composeLayout(comps, isolated, g, {
    width,
    height,
    padding,
    K,
    nodeRadius,
    nodePadding,
    maxUpscale,
    componentMargin: options.componentMargin,
    seed: seedHash,
  });
  stats.scale = placed.scale;

  // --- verification: count residual overlaps (expected 0) ---
  stats.overlapPairs = countOverlaps(placed.nodes);

  // --- final crossing count for observability (deadline-bounded grid pass) ---
  const totalEdges = g.edgePairs.length / 2;
  const statsDeadline = t0 + budget * 1.2;
  if (totalEdges > 0 && totalEdges <= 30000 && now() < statsDeadline) {
    let crossings = 0;
    for (const comp of comps) {
      if (crossings === -1 || now() > statsDeadline) {
        crossings = -1;
        break;
      }
      const grid = buildSegGrid(comp, K);
      const c = countComponentCrossings(comp, grid, null, statsDeadline);
      crossings = c === -1 ? -1 : crossings + c;
    }
    stats.edgeCrossings = crossings;
    if (crossings === -1) stats.budgetExceeded = true;
  } else {
    stats.edgeCrossings = totalEdges === 0 ? 0 : -1;
    if (totalEdges > 0 && totalEdges <= 30000) stats.budgetExceeded = true;
  }
  stats.phaseMs.compose = now() - tCompose;
  stats.elapsedMs = now() - t0;

  return {
    nodes: placed.nodes,
    edges: echoEdges,
    bounds: placed.bounds,
    stats,
  };
}
