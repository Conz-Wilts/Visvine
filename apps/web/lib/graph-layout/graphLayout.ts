/**
 * graphLayout.ts — a self-contained graph layout engine.
 *
 * Produces an organic, force-graph-style layout with zero node-node overlap,
 * aggressive edge-crossing reduction, and a hard wall-clock budget so the
 * first visually-complete layout is available well inside 3 seconds.
 *
 * No dependencies. Pure TypeScript, runs in browsers, Web Workers, and Node.
 *
 * Pipeline (each stage is the budget-optimal pick from the graph-drawing
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
 */

/* ============================== Public API =============================== */

export type NodeId = string | number;

export interface GraphNodeInput {
  id: NodeId;
  /** Visual radius of this node. Defaults to options.nodeRadius. */
  r?: number;
}

export interface GraphEdgeInput {
  source: NodeId;
  target: NodeId;
}

export interface LayoutOptions {
  /** Viewport width the layout is normalized into. Default 1200. */
  width?: number;
  /** Viewport height the layout is normalized into. Default 800. */
  height?: number;
  /** Inner padding kept clear inside the viewport. Default 32. */
  padding?: number;
  /** Default node radius when a node has no `r`. Default 8. */
  nodeRadius?: number;
  /** Minimum clearance enforced between node borders. Default 4. */
  nodePadding?: number;
  /** Ideal edge length K (the natural spring length). Default 48. */
  idealEdgeLength?: number;
  /**
   * Hard wall-clock budget in ms for all heavy computation. The engine
   * degrades gracefully: refinement stops first, the crossing pass is skipped
   * next; decomposition, initialization, overlap removal and packing always
   * run (they are cheap). Default 2500 — comfortably inside a 3 s render SLA.
   */
  timeBudgetMs?: number;
  /** Override the auto-derived deterministic seed. */
  seed?: number | string;
  /**
   * Strength of the mass-proportional pull toward each component's centroid
   * (F = gravity·K·(deg+1)). Counteracts the unbounded inflation sparse
   * structures (cycles, paths, trees) suffer under pure repulsion. Default 0.15.
   */
  gravity?: number;
  /** Run the greedy crossing-reduction post-pass when budget allows. Default true. */
  refineCrossings?: boolean;
  /** Cap on how much a small graph may be scaled UP to fill the viewport. Default 1.25. */
  maxUpscale?: number;
  /**
   * Clear space kept between neighbouring connected components in the
   * composed layout. Defaults to max(0.75·K, 24) — override when K is
   * large relative to node size (e.g. big card nodes) and the default reads
   * as excessive whitespace between components.
   */
  componentMargin?: number;
  /**
   * Progress callback (only used by layoutGraphAsync). Receives normalized
   * intermediate snapshots suitable for painting immediately.
   */
  onProgress?: (snapshot: LayoutSnapshot) => void;
}

export interface PositionedNode {
  id: NodeId;
  x: number;
  y: number;
  /**
   * Node radius IN LAYOUT OUTPUT UNITS. Radii are scaled together with
   * positions during viewport normalization, so "zero overlap" holds exactly
   * at these radii. Render at this r (or smaller) to preserve the guarantee.
   */
  r: number;
}

export interface LayoutEdgeOutput {
  source: NodeId;
  target: NodeId;
}

export interface LayoutStats {
  elapsedMs: number;
  /** Total force iterations across all components. */
  forceIterations: number;
  componentCount: number;
  isolatedCount: number;
  /** Node-node overlapping pairs in the final layout (verified; expected 0). */
  overlapPairs: number;
  /** Proper edge-edge crossings in the final layout. -1 if skipped (too large / out of budget). */
  edgeCrossings: number;
  /** Crossings removed by the greedy vertex-move pass (0 if pass skipped). */
  crossingsRemoved: number;
  /** Uniform scale factor applied during viewport normalization. */
  scale: number;
  /**
   * True if the time budget truncated any stage (fewer force iterations,
   * skipped/cut crossing pass, or an abandoned stats count). Truncation
   * points depend on machine load, so a true value also means this run is
   * NOT guaranteed reproducible — don't cache layouts when this is set.
   */
  budgetExceeded: boolean;
  phaseMs: {
    prepare: number;
    initialize: number;
    forces: number;
    overlap: number;
    crossings: number;
    compose: number;
  };
}

export interface LayoutResult {
  nodes: PositionedNode[];
  edges: LayoutEdgeOutput[];
  /** Tight bounding box of the laid-out content, in output coordinates. */
  bounds: { x: number; y: number; width: number; height: number };
  stats: LayoutStats;
}

export interface LayoutSnapshot {
  nodes: PositionedNode[];
  phase: 'initialize' | 'forces' | 'overlap' | 'crossings' | 'compose';
  /** Approximate completion in [0, 1]. */
  progress: number;
}

/** Synchronous layout. Returns within ~timeBudgetMs (default 2500 ms). */
export function layoutGraph(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
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
 * graphs — this is the "visually complete approximation" for the 3 s SLA.
 */
export async function layoutGraphAsync(
  nodes: GraphNodeInput[],
  edges: GraphEdgeInput[],
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

/* ========================= Determinism utilities ========================= */

function now(): number {
  const p = (globalThis as { performance?: { now(): number } }).performance;
  return p ? p.now() : Date.now();
}

function yieldToEventLoop(): Promise<void> {
  const g = globalThis as {
    requestAnimationFrame?: (cb: () => void) => void;
    setTimeout: (cb: () => void, ms: number) => void;
    document?: { visibilityState?: string };
  };
  // requestAnimationFrame aligns snapshot emission with paint frames, but
  // browsers suspend rAF entirely in hidden tabs — a layout started in a
  // background tab would never finish. Only use rAF when actually visible.
  const visible = g.document?.visibilityState === 'visible';
  return new Promise((resolve) =>
    visible && typeof g.requestAnimationFrame === 'function'
      ? g.requestAnimationFrame(() => resolve())
      : g.setTimeout(resolve, 0),
  );
}

/** FNV-1a 32-bit string hash — stable seed derivation from graph identity. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * mulberry32 — tiny, fast, passes gjrand; 2^32 period is far beyond the
 * <10^6 draws a layout makes. All engine randomness flows through one
 * instance so identical inputs give identical layouts.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

/* ========================== Graph preprocessing ========================== */

interface PreparedGraph {
  n: number;
  ids: NodeId[];
  radii: Float64Array;
  /** Deduplicated, self-loop-free undirected edges as [a0,b0, a1,b1, ...]. */
  edgePairs: Int32Array;
  /** CSR adjacency. */
  adjOffsets: Int32Array;
  adjTargets: Int32Array;
  degree: Int32Array;
}

function prepareGraph(
  nodesIn: GraphNodeInput[],
  edgesIn: GraphEdgeInput[],
  defaultR: number,
): PreparedGraph {
  // Dedupe nodes by id, preserving first occurrence (stable + deterministic).
  const index = new Map<NodeId, number>();
  const ids: NodeId[] = [];
  const radiiList: number[] = [];
  for (const nd of nodesIn) {
    if (index.has(nd.id)) continue;
    index.set(nd.id, ids.length);
    ids.push(nd.id);
    // Reject non-finite/non-positive radii and clamp absurd ones: a single
    // r = Infinity would otherwise poison the K derivation and send the
    // quadtree's coincident-point jiggle loop spinning forever.
    const r = nd.r;
    radiiList.push(
      r !== undefined && Number.isFinite(r) && r > 0 ? Math.min(r, 1e7) : defaultR,
    );
  }
  const n = ids.length;
  const radii = Float64Array.from(radiiList);

  // Dedupe undirected edges; drop self-loops and dangling references.
  // Key a*n+b (a<b) is unique and stays a safe integer for n < 2^26.
  const seen = new Set<number>();
  const pairs: number[] = [];
  for (const e of edgesIn) {
    const a = index.get(e.source);
    const b = index.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const lo = a < b ? a : b;
    const hi = a < b ? b : a;
    const key = lo * n + hi;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push(lo, hi);
  }
  const edgePairs = Int32Array.from(pairs);
  const m = edgePairs.length / 2;

  // CSR adjacency (both directions).
  const degree = new Int32Array(n);
  for (let i = 0; i < m; i++) {
    degree[edgePairs[2 * i]]++;
    degree[edgePairs[2 * i + 1]]++;
  }
  const adjOffsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjOffsets[i + 1] = adjOffsets[i] + degree[i];
  const adjTargets = new Int32Array(adjOffsets[n]);
  const cursor = adjOffsets.slice(0, n);
  for (let i = 0; i < m; i++) {
    const a = edgePairs[2 * i];
    const b = edgePairs[2 * i + 1];
    adjTargets[cursor[a]++] = b;
    adjTargets[cursor[b]++] = a;
  }
  return { n, ids, radii, edgePairs, adjOffsets, adjTargets, degree };
}

/** Union-find with union-by-size and path halving: O(m·α(n)). */
function connectedComponents(g: PreparedGraph): Int32Array {
  const parent = new Int32Array(g.n);
  const size = new Int32Array(g.n).fill(1);
  for (let i = 0; i < g.n; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  };
  const m = g.edgePairs.length / 2;
  for (let i = 0; i < m; i++) {
    let a = find(g.edgePairs[2 * i]);
    let b = find(g.edgePairs[2 * i + 1]);
    if (a === b) continue;
    if (size[a] < size[b]) {
      const t = a;
      a = b;
      b = t;
    }
    parent[b] = a;
    size[a] += size[b];
  }
  const roots = new Int32Array(g.n);
  for (let i = 0; i < g.n; i++) roots[i] = find(i);
  return roots;
}

/** A component with its own local index space and CSR. */
interface Component {
  /** global node index per local index */
  globals: Int32Array;
  /** local edge endpoint pairs */
  edges: Int32Array;
  adjOffsets: Int32Array;
  adjTargets: Int32Array;
  degree: Int32Array;
  radii: Float64Array;
  px: Float64Array;
  py: Float64Array;
}

function buildComponents(g: PreparedGraph, roots: Int32Array): Component[] {
  const byRoot = new Map<number, number[]>();
  for (let i = 0; i < g.n; i++) {
    let list = byRoot.get(roots[i]);
    if (!list) byRoot.set(roots[i], (list = []));
    list.push(i);
  }
  // Deterministic ordering: largest first (gets refinement budget first),
  // ties broken by smallest member index.
  const groups = [...byRoot.values()].sort(
    (a, b) => b.length - a.length || a[0] - b[0],
  );
  const localOf = new Int32Array(g.n);
  const comps: Component[] = [];
  for (const group of groups) {
    const n = group.length;
    const globals = Int32Array.from(group);
    for (let i = 0; i < n; i++) localOf[group[i]] = i;
    const edges: number[] = [];
    const degree = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const gi = group[i];
      for (let e = g.adjOffsets[gi]; e < g.adjOffsets[gi + 1]; e++) {
        const gj = g.adjTargets[e];
        if (gj > gi) {
          edges.push(localOf[gi], localOf[gj]);
        }
      }
      degree[i] = g.adjOffsets[gi + 1] - g.adjOffsets[gi];
    }
    const edgeArr = Int32Array.from(edges);
    const adjOffsets = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) adjOffsets[i + 1] = adjOffsets[i] + degree[i];
    const adjTargets = new Int32Array(adjOffsets[n]);
    const cursor = adjOffsets.slice(0, n);
    const m = edgeArr.length / 2;
    for (let i = 0; i < m; i++) {
      const a = edgeArr[2 * i];
      const b = edgeArr[2 * i + 1];
      adjTargets[cursor[a]++] = b;
      adjTargets[cursor[b]++] = a;
    }
    const radii = new Float64Array(n);
    for (let i = 0; i < n; i++) radii[i] = g.radii[group[i]];
    comps.push({
      globals,
      edges: edgeArr,
      adjOffsets,
      adjTargets,
      degree,
      radii,
      px: new Float64Array(n),
      py: new Float64Array(n),
    });
  }
  return comps;
}

/* ================================== BFS ================================== */

/**
 * Unweighted BFS writing hop counts into `dist` (-1 = unreached).
 * Used by PivotMDS columns and by the phyllotaxis ordering.
 */
function bfs(
  comp: Component,
  source: number,
  dist: Int32Array,
  queue: Int32Array,
): void {
  dist.fill(-1);
  dist[source] = 0;
  queue[0] = source;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const u = queue[head++];
    const du = dist[u];
    for (let e = comp.adjOffsets[u]; e < comp.adjOffsets[u + 1]; e++) {
      const v = comp.adjTargets[e];
      if (dist[v] === -1) {
        dist[v] = du + 1;
        queue[tail++] = v;
      }
    }
  }
}

/* ======================= Initial placement stage ========================= */

/**
 * Phyllotaxis (sunflower) placement: node i at radius s·√(i+0.5), angle
 * i·golden-angle. Deterministic, uniform-density, collision-free disc — the
 * ideal cheap start for small components. Nodes are placed in BFS order from
 * the highest-degree vertex so graph-adjacent nodes start spatially adjacent,
 * which measurably cuts untangling iterations.
 */
function initPhyllotaxis(comp: Component, K: number): void {
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
 * match graph-theoretic distances (in the least-squares sense of the inner-
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
function initPivotMDS(comp: Component, K: number, rng: Rng): boolean {
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
  // Degenerate spectrum (e.g. star graphs put all leaves at one point):
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
function jiggleCoincident(comp: Component, K: number, rng: Rng): void {
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

/* ============================== Quadtree ================================= */

/**
 * Flat-array quadtree shared by Barnes-Hut repulsion and collision passes.
 *
 * Storage: cell c owns children[4c..4c+3]; a slot holds -1 (empty), a cell
 * index (≥0), or an encoded leaf -(nodeIndex+2). Cells are created in
 * top-down order, so child index > parent index always — which lets the
 * mass/center-of-mass/max-radius aggregation run as a single reverse-order
 * sweep instead of an explicit post-order traversal.
 */
const QT_EMPTY = -1;
const QT_MAX_DEPTH = 32;

interface Quadtree {
  children: Int32Array;
  cx: Float64Array;
  cy: Float64Array;
  half: Float64Array;
  mass: Float64Array;
  comX: Float64Array;
  comY: Float64Array;
  maxR: Float64Array;
  count: number;
}

function buildQuadtree(
  n: number,
  px: Float64Array,
  py: Float64Array,
  radii: Float64Array,
  nodeMass: Float64Array,
  rng: Rng,
  K: number,
): Quadtree {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] < minY) minY = py[i];
    if (py[i] > maxY) maxY = py[i];
  }
  const side = Math.max(maxX - minX, maxY - minY, 1e-6) * 1.0001;
  const rootCx = (minX + maxX) / 2;
  const rootCy = (minY + maxY) / 2;

  let cap = Math.max(64, 2 * n);
  let children = new Int32Array(cap * 4).fill(QT_EMPTY);
  let cx = new Float64Array(cap);
  let cy = new Float64Array(cap);
  let half = new Float64Array(cap);
  let count = 0;

  const newCell = (x: number, y: number, h: number): number => {
    if (count === cap) {
      cap *= 2;
      const c2 = new Int32Array(cap * 4).fill(QT_EMPTY);
      c2.set(children);
      children = c2;
      const grow = (a: Float64Array) => {
        const b = new Float64Array(cap);
        b.set(a);
        return b;
      };
      cx = grow(cx);
      cy = grow(cy);
      half = grow(half);
    }
    const c = count++;
    cx[c] = x;
    cy[c] = y;
    half[c] = h;
    return c;
  };
  newCell(rootCx, rootCy, side / 2);

  for (let i = 0; i < n; i++) {
    // Any non-finite coordinate (defensive: shouldn't occur after input
    // validation) would spin the insert loop forever — reset it instead.
    if (!Number.isFinite(px[i]) || !Number.isFinite(py[i])) {
      px[i] = rootCx + (rng() - 0.5) * side;
      py[i] = rootCy + (rng() - 0.5) * side;
    }
    let jitter = Math.max(1e-4 * K, 1e-9);
    // Insertion with jiggle-and-restart on coincident points / depth overflow.
    insert: for (;;) {
      let c = 0;
      let depth = 0;
      for (;;) {
        const q = (px[i] >= cx[c] ? 1 : 0) | (py[i] >= cy[c] ? 2 : 0);
        const slot = 4 * c + q;
        const v = children[slot];
        if (v === QT_EMPTY) {
          children[slot] = -(i + 2);
          break insert;
        }
        if (v >= 0) {
          c = v;
          depth++;
          continue;
        }
        const j = -v - 2;
        if (
          depth >= QT_MAX_DEPTH ||
          (px[i] === px[j] && py[i] === py[j])
        ) {
          px[i] += (rng() - 0.5) * jitter;
          py[i] += (rng() - 0.5) * jitter;
          jitter *= 4;
          continue insert; // restart from the root with the nudged point
        }
        // Split: push existing leaf j one level down, then retry placing i.
        const h2 = half[c] / 2;
        const ncx = cx[c] + ((q & 1) ? h2 : -h2);
        const ncy = cy[c] + ((q & 2) ? h2 : -h2);
        const nc = newCell(ncx, ncy, h2);
        children[slot] = nc;
        const qj = (px[j] >= ncx ? 1 : 0) | (py[j] >= ncy ? 2 : 0);
        children[4 * nc + qj] = -(j + 2);
        c = nc;
        depth++;
      }
    }
  }

  // Bottom-up aggregation via reverse index order (children > parents).
  const mass = new Float64Array(count);
  const comX = new Float64Array(count);
  const comY = new Float64Array(count);
  const maxR = new Float64Array(count);
  for (let c = count - 1; c >= 0; c--) {
    let m = 0;
    let sx = 0;
    let sy = 0;
    let mr = 0;
    for (let q = 0; q < 4; q++) {
      const v = children[4 * c + q];
      if (v === QT_EMPTY) continue;
      if (v < QT_EMPTY) {
        const j = -v - 2;
        const mj = nodeMass[j];
        m += mj;
        sx += mj * px[j];
        sy += mj * py[j];
        if (radii[j] > mr) mr = radii[j];
      } else {
        m += mass[v];
        sx += mass[v] * comX[v];
        sy += mass[v] * comY[v];
        if (maxR[v] > mr) mr = maxR[v];
      }
    }
    mass[c] = m;
    comX[c] = m > 0 ? sx / m : cx[c];
    comY[c] = m > 0 ? sy / m : cy[c];
    maxR[c] = mr;
  }
  return { children, cx, cy, half, mass, comX, comY, maxR, count };
}

/* ====================== Force refinement (Hu + FA2) ====================== */

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
interface ForceConfig {
  K: number;
  rng: Rng;
  deadline: number;
  plannedIters: number;
  collideIters: number;
  nodePadding: number;
  gravity: number;
  /** Enable PrEd node-edge repulsion in the last iterations (small graphs). */
  nodeEdgeRepulsion: boolean;
}

/**
 * Generator so the async driver can yield to the event loop mid-simulation:
 * yields (no value) every few iterations; returns the iteration count.
 * The sync driver simply drains it.
 */
function* runForces(comp: Component, cfg: ForceConfig): Generator<void, number> {
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

/**
 * One Gauss-Seidel circle-collision sweep (d3-forceCollide style):
 * for every overlapping pair, displace both nodes apart along the center
 * line, split by mass (r²) so small nodes yield. `strength` < 1 blends
 * simultaneous corrections to avoid the classic alternating-overshoot
 * shimmer. Pairs are visited once via the leaf-ordering trick (j > i).
 */
function collidePass(
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
function stackingPass(comp: Component, pad: number): void {
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

/* =================== Segment grid + crossing machinery =================== */

/**
 * Uniform-grid spatial index over edge segments. Cells are keyed on a dense
 * integer lattice; each segment registers in every cell it passes through
 * (Amanatides-Woo traversal). Crossing candidates are segments sharing a
 * cell — expected O(m + X) total work for realistic layouts, versus the
 * O((m+X) log m) and brutal robustness engineering of Bentley-Ottmann.
 */
interface SegGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  map: Map<number, number[]>;
  /** cells occupied by each edge, for honest removal on vertex moves */
  edgeCells: number[][];
}

function cellsOfSegment(
  grid: SegGrid,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  out: number[],
): void {
  const inv = 1 / grid.cell;
  let cx = Math.floor((ax - grid.minX) * inv);
  let cy = Math.floor((ay - grid.minY) * inv);
  const ex = Math.floor((bx - grid.minX) * inv);
  const ey = Math.floor((by - grid.minY) * inv);
  out.push(cy * grid.cols + cx);
  if (cx === ex && cy === ey) return;
  // Amanatides-Woo voxel walk. Division by zero yields ±Infinity, which
  // correctly freezes that axis for horizontal/vertical segments.
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const nextX = grid.minX + (cx + (dx > 0 ? 1 : 0)) * grid.cell;
  const nextY = grid.minY + (cy + (dy > 0 ? 1 : 0)) * grid.cell;
  let tMaxX = dx !== 0 ? (nextX - ax) / dx : Infinity;
  let tMaxY = dy !== 0 ? (nextY - ay) / dy : Infinity;
  const tDeltaX = dx !== 0 ? Math.abs(grid.cell / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(grid.cell / dy) : Infinity;
  let guard = 4 * (Math.abs(ex - cx) + Math.abs(ey - cy)) + 8;
  while ((cx !== ex || cy !== ey) && guard-- > 0) {
    if (tMaxX < tMaxY) {
      cx += stepX;
      tMaxX += tDeltaX;
    } else {
      cy += stepY;
      tMaxY += tDeltaY;
    }
    out.push(cy * grid.cols + cx);
  }
  // FP insurance: if a corner-case misstep exhausted the guard before
  // landing on the end cell, register it anyway (a duplicate is harmless;
  // a missing end cell would hide crossings near the segment's endpoint).
  const endKey = ey * grid.cols + ex;
  if (out[out.length - 1] !== endKey) out.push(endKey);
}

function buildSegGrid(
  comp: Component,
  K: number,
): SegGrid {
  const m = comp.edges.length / 2;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  const n = comp.globals.length;
  for (let i = 0; i < n; i++) {
    if (comp.px[i] < minX) minX = comp.px[i];
    if (comp.px[i] > maxX) maxX = comp.px[i];
    if (comp.py[i] < minY) minY = comp.py[i];
  }
  // Cell ≈ K: edges average ~K long, so most occupy only a handful of cells.
  const cell = Math.max(K, 1e-6);
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 2);
  const grid: SegGrid = {
    cell,
    minX: minX - cell,
    minY: minY - cell,
    cols: cols + 2,
    map: new Map(),
    edgeCells: [],
  };
  for (let e = 0; e < m; e++) {
    const a = comp.edges[2 * e];
    const b = comp.edges[2 * e + 1];
    const cells: number[] = [];
    cellsOfSegment(grid, comp.px[a], comp.py[a], comp.px[b], comp.py[b], cells);
    grid.edgeCells.push(cells);
    for (const c of cells) {
      let list = grid.map.get(c);
      if (!list) grid.map.set(c, (list = []));
      list.push(e);
    }
  }
  return grid;
}

function gridRemoveEdge(grid: SegGrid, e: number): void {
  for (const c of grid.edgeCells[e]) {
    const list = grid.map.get(c);
    if (!list) continue;
    const idx = list.indexOf(e);
    if (idx >= 0) list.splice(idx, 1);
  }
  grid.edgeCells[e] = [];
}

function gridAddEdge(grid: SegGrid, comp: Component, e: number): void {
  const a = comp.edges[2 * e];
  const b = comp.edges[2 * e + 1];
  const cells: number[] = [];
  cellsOfSegment(grid, comp.px[a], comp.py[a], comp.px[b], comp.py[b], cells);
  grid.edgeCells[e] = cells;
  for (const c of cells) {
    let list = grid.map.get(c);
    if (!list) grid.map.set(c, (list = []));
    list.push(e);
  }
}

/** 2×signed area of triangle abc — the standard orientation predicate. */
function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Proper (interior) segment crossing. Shared-endpoint contact and collinear
 *  touching do not count — adjacent edges always "touch" at their vertex. */
function segmentsCross(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  q1x: number,
  q1y: number,
  q2x: number,
  q2y: number,
): boolean {
  const o1 = orient(p1x, p1y, p2x, p2y, q1x, q1y);
  const o2 = orient(p1x, p1y, p2x, p2y, q2x, q2y);
  if (o1 * o2 >= 0) return false;
  const o3 = orient(q1x, q1y, q2x, q2y, p1x, p1y);
  const o4 = orient(q1x, q1y, q2x, q2y, p2x, p2y);
  return o3 * o4 < 0;
}

function edgesShareVertex(comp: Component, e1: number, e2: number): boolean {
  const a1 = comp.edges[2 * e1];
  const b1 = comp.edges[2 * e1 + 1];
  const a2 = comp.edges[2 * e2];
  const b2 = comp.edges[2 * e2 + 1];
  return a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2;
}

function edgeCross(comp: Component, e1: number, e2: number): boolean {
  if (edgesShareVertex(comp, e1, e2)) return false;
  const a1 = comp.edges[2 * e1];
  const b1 = comp.edges[2 * e1 + 1];
  const a2 = comp.edges[2 * e2];
  const b2 = comp.edges[2 * e2 + 1];
  return segmentsCross(
    comp.px[a1], comp.py[a1], comp.px[b1], comp.py[b1],
    comp.px[a2], comp.py[a2], comp.px[b2], comp.py[b2],
  );
}

/**
 * Count all proper crossings in a component; optionally per-edge tallies.
 * Returns -1 if the deadline expired or internal limits tripped (callers
 * must treat the count as unavailable, not zero).
 *
 * Hub safety: edges sharing a vertex (a degree-d hub puts d segments in one
 * cell ⇒ C(d,2) pairs) are rejected BEFORE touching the dedupe set — they
 * can never properly cross, and admitting them would blow V8's ~2²⁴ Set cap
 * on hub-heavy graphs. The remaining true candidates are deadline-checked.
 */
function countComponentCrossings(
  comp: Component,
  grid: SegGrid,
  perEdge: Int32Array | null,
  deadline = Infinity,
): number {
  const m = comp.edges.length / 2;
  const seen = new Set<number>();
  let total = 0;
  let sinceCheck = 0;
  for (const list of grid.map.values()) {
    const len = list.length;
    if (len > 4096) continue; // pathological pile-up: skip, deadline-safe
    sinceCheck += (len * (len - 1)) / 2;
    if (sinceCheck > 32768) {
      sinceCheck = 0;
      if (now() > deadline) return -1;
      if (seen.size > 6_000_000) return -1; // stay far from the Set cap
    }
    for (let i = 0; i < len; i++) {
      for (let j = i + 1; j < len; j++) {
        const e1 = list[i] < list[j] ? list[i] : list[j];
        const e2 = list[i] < list[j] ? list[j] : list[i];
        if (e1 === e2) continue;
        if (edgesShareVertex(comp, e1, e2)) continue; // cheap, pre-Set
        const key = e1 * m + e2;
        if (seen.has(key)) continue;
        seen.add(key);
        if (edgeCross(comp, e1, e2)) {
          total++;
          if (perEdge) {
            perEdge[e1]++;
            perEdge[e2]++;
          }
        }
      }
    }
  }
  return total;
}

/**
 * PrEd node-edge repulsion (Bertault, GD 2000): a vertex v closer than γ to a
 * non-incident edge is pushed off the edge's supporting line with magnitude
 * (γ−d)²/d — quadratic in penetration depth, singular at contact. This kills
 * the worst perceptual defect short of overlap: an edge grazing through an
 * unrelated node reads as a false incidence.
 */
function applyNodeEdgeRepulsion(
  comp: Component,
  fx: Float64Array,
  fy: Float64Array,
  K: number,
): void {
  const n = comp.globals.length;
  const grid = buildSegGrid(comp, K);
  const inv = 1 / grid.cell;
  const stamp = new Int32Array(comp.edges.length / 2).fill(-1);
  for (let v = 0; v < n; v++) {
    const gamma = 3 * comp.radii[v];
    const x = comp.px[v];
    const y = comp.py[v];
    const c0x = Math.floor((x - gamma - grid.minX) * inv);
    const c1x = Math.floor((x + gamma - grid.minX) * inv);
    const c0y = Math.floor((y - gamma - grid.minY) * inv);
    const c1y = Math.floor((y + gamma - grid.minY) * inv);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = grid.map.get(cy * grid.cols + cx);
        if (!list) continue;
        for (const e of list) {
          if (stamp[e] === v) continue;
          stamp[e] = v;
          const a = comp.edges[2 * e];
          const b = comp.edges[2 * e + 1];
          if (a === v || b === v) continue;
          const abx = comp.px[b] - comp.px[a];
          const aby = comp.py[b] - comp.py[a];
          const len2 = abx * abx + aby * aby;
          if (len2 < 1e-12) continue;
          const t = ((x - comp.px[a]) * abx + (y - comp.py[a]) * aby) / len2;
          if (t <= 0 || t >= 1) continue; // beyond the segment: node-node forces own it
          const projX = comp.px[a] + t * abx;
          const projY = comp.py[a] + t * aby;
          let dx = x - projX;
          let dy = y - projY;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d >= gamma) continue;
          if (d < 0.05 * gamma) {
            // On-the-line degenerate: push perpendicular to the edge —
            // toward the side the node is actually on (a fixed side would
            // shove nodes THROUGH the edge from the other side).
            const il = 1 / Math.sqrt(len2);
            const side =
              abx * (y - comp.py[a]) - aby * (x - comp.px[a]) >= 0 ? 1 : -1;
            dx = -aby * il * side;
            dy = abx * il * side;
            d = 0.05 * gamma;
          } else {
            dx /= d;
            dy /= d;
          }
          const mag = ((gamma - d) * (gamma - d)) / d;
          fx[v] += dx * mag;
          fy[v] += dy * mag;
        }
      }
    }
  }
}

/**
 * Greedy vertex-move crossing reduction (the practical scheme of Demel et
 * al. GD'18 / Radermacher & Rutter ESA'19): repeatedly take a vertex whose
 * incident edges participate in many crossings, sample candidate positions
 * in two concentric shrinking squares around it, count only the crossings of
 * its OWN incident edges (grid-local — this is what makes a move ~O(deg)),
 * and accept strictly-improving moves that don't create node overlap.
 * Exact minimization is NP-hard and APX-hard; this is the published
 * cost-effective heuristic family for a time-boxed post-pass.
 */
function reduceCrossings(
  comp: Component,
  K: number,
  pad: number,
  rng: Rng,
  deadline: number,
): number {
  const n = comp.globals.length;
  const m = comp.edges.length / 2;
  if (n < 4 || m < 3) return 0;

  const grid = buildSegGrid(comp, K);
  const perEdge = new Int32Array(m);
  // Deadline-aware census: on timeout (or zero crossings) the pass is moot.
  const census = countComponentCrossings(comp, grid, perEdge, deadline);
  if (census <= 0) return 0;

  // Incident-edge index so accepted moves don't rescan all m edges.
  const incident: number[][] = Array.from({ length: n }, () => []);
  for (let e = 0; e < m; e++) {
    incident[comp.edges[2 * e]].push(e);
    incident[comp.edges[2 * e + 1]].push(e);
  }

  // Vertex badness = crossings on incident edges. Hubs are excluded: moving
  // a degree-d vertex costs O(d · cell-density) per candidate and hub moves
  // rarely help (their crossings are load-bearing structure, not accidents).
  const score = new Float64Array(n);
  for (let e = 0; e < m; e++) {
    score[comp.edges[2 * e]] += perEdge[e];
    score[comp.edges[2 * e + 1]] += perEdge[e];
  }
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((v) => score[v] > 0 && comp.degree[v] <= 64)
    .sort((a, b) => score[b] - score[a] || a - b)
    .slice(0, Math.min(160, n));

  // Node-proximity hash for overlap rejection of candidate positions.
  let maxR = 0;
  for (let i = 0; i < n; i++) if (comp.radii[i] > maxR) maxR = comp.radii[i];
  const nCell = Math.max(2 * maxR + pad, 1e-6);
  const nodeGrid = new Map<number, number[]>();
  const nKey = (x: number, y: number) =>
    Math.floor(y / nCell) * 1048576 + Math.floor(x / nCell);
  for (let i = 0; i < n; i++) {
    const key = nKey(comp.px[i], comp.py[i]);
    let list = nodeGrid.get(key);
    if (!list) nodeGrid.set(key, (list = []));
    list.push(i);
  }
  const wouldOverlap = (v: number, x: number, y: number): boolean => {
    const cx = Math.floor(x / nCell);
    const cy = Math.floor(y / nCell);
    for (let by = cy - 1; by <= cy + 1; by++) {
      for (let bx = cx - 1; bx <= cx + 1; bx++) {
        const list = nodeGrid.get(by * 1048576 + bx);
        if (!list) continue;
        for (const u of list) {
          if (u === v) continue;
          const rr = comp.radii[u] + comp.radii[v] + pad;
          const dx = comp.px[u] - x;
          const dy = comp.py[u] - y;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    }
    return false;
  };

  const stamp = new Int32Array(m).fill(-1);
  let stampGen = 0;
  const scratchCells: number[] = [];
  /** Crossings of v's incident edges if v sat at (x,y). All edges incident to
   *  v are excluded from counting (they'd move along with v). */
  const incidentCost = (v: number, x: number, y: number): number => {
    let cost = 0;
    for (let e = comp.adjOffsets[v]; e < comp.adjOffsets[v + 1]; e++) {
      const u = comp.adjTargets[e];
      // Fresh stamp epoch PER incident edge: a foreign edge crossing two of
      // v's edges must count twice, or candidate costs are undercounted and
      // cost-increasing moves can be accepted as "improvements".
      stampGen++;
      scratchCells.length = 0;
      cellsOfSegment(grid, x, y, comp.px[u], comp.py[u], scratchCells);
      for (const c of scratchCells) {
        const list = grid.map.get(c);
        if (!list || list.length > 1024) continue; // hub-cell pile-up guard
        for (const e2 of list) {
          if (stamp[e2] === stampGen) continue;
          stamp[e2] = stampGen;
          const a2 = comp.edges[2 * e2];
          const b2 = comp.edges[2 * e2 + 1];
          // Skip edges touching v (they move with it) or sharing u.
          if (a2 === v || b2 === v || a2 === u || b2 === u) continue;
          if (
            segmentsCross(
              x, y, comp.px[u], comp.py[u],
              comp.px[a2], comp.py[a2], comp.px[b2], comp.py[b2],
            )
          ) {
            cost++;
          }
        }
      }
    }
    return cost;
  };

  let removed = 0;
  for (const v of order) {
    if (now() > deadline) break;
    const cur = incidentCost(v, comp.px[v], comp.py[v]);
    if (cur === 0) continue;
    let bestX = comp.px[v];
    let bestY = comp.py[v];
    let bestCost = cur;
    // Two shrinking-square sampling levels (Demel et al. use side·b^level).
    let outOfTime = false;
    for (const side of [3 * K, 0.8 * K]) {
      for (let t = 0; t < 12; t++) {
        // Per-candidate deadline check: one candidate is the unit of work
        // here, and a vertex can be costly even with the hub cap.
        if (now() > deadline) {
          outOfTime = true;
          break;
        }
        const x = bestX + (rng() - 0.5) * side;
        const y = bestY + (rng() - 0.5) * side;
        if (wouldOverlap(v, x, y)) continue;
        const cost = incidentCost(v, x, y);
        if (cost < bestCost) {
          bestCost = cost;
          bestX = x;
          bestY = y;
        }
      }
      if (outOfTime) break;
    }
    if (bestCost < cur) {
      // Honest grid maintenance: re-rasterize v's incident edges.
      for (const e of incident[v]) gridRemoveEdge(grid, e);
      // Move v in the node grid too.
      const oldKey = nKey(comp.px[v], comp.py[v]);
      const oldList = nodeGrid.get(oldKey);
      if (oldList) {
        const idx = oldList.indexOf(v);
        if (idx >= 0) oldList.splice(idx, 1);
      }
      comp.px[v] = bestX;
      comp.py[v] = bestY;
      const newKey = nKey(bestX, bestY);
      let newList = nodeGrid.get(newKey);
      if (!newList) nodeGrid.set(newKey, (newList = []));
      newList.push(v);
      for (const e of incident[v]) gridAddEdge(grid, comp, e);
      removed += cur - bestCost;
    }
    if (outOfTime) break;
  }
  return removed;
}

/* ================ Component composition (organic packing) ================ */

/**
 * A connected component (or isolated node) abstracted as its bounding circle
 * for the composition stage. `place` translates the component's local
 * coordinates so its content center lands at the packed circle center.
 */
interface MetaCircle {
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
function packCircles(
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
  // globals.length) are read on that path; the graph fields stay empty.
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
  nodesIn: GraphNodeInput[],
  edgesIn: GraphEdgeInput[],
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
  const g = prepareGraph(nodesIn, edgesIn, nodeRadius);
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

/** Final-layout overlap verification via a uniform grid (O(n·density)). */
function countOverlaps(nodes: PositionedNode[]): number {
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

/**
 * Compose per-component layouts (plus isolated singletons) into one organic
 * cloud via force-directed circle packing, then uniformly scale into the
 * viewport. Radii scale together with positions so the zero-overlap
 * guarantee survives normalization exactly.
 */
function composeLayout(
  comps: Component[],
  isolated: Component[],
  g: PreparedGraph,
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
