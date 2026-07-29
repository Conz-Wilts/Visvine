export type NodeId = string | number;

export interface ContextNodeInput {
  id: NodeId;
  /** Visual radius of this node. Defaults to options.nodeRadius. */
  r?: number;
}

export interface ContextEdgeInput {
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
  /** Cap on how much a small context may be scaled UP to fill the viewport. Default 1.25. */
  maxUpscale?: number;
  /**
   * Clear space kept between neighbouring connected components in the
   * composed layout. Defaults to max(0.75·K, 24) — override when K is
   * large relative to node size (e.g. big card nodes) and the default reads
   * as excessive whitespace between components.
   */
  componentMargin?: number;
  /**
   * Progress callback (only used by layoutContextAsync). Receives normalized
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

export type Rng = () => number;

/* ================= Internal shapes shared across the stages ================ */

/** The deduplicated, CSR-indexed form every stage after `prepare` works on. */
export interface PreparedContext {
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

/** A component with its own local index space and CSR. */
export interface Component {
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
