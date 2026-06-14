import { layoutGraph } from './lib/graph-layout/graphLayout';
import type { GraphNodeInput, GraphEdgeInput } from './lib/graph-layout/graphLayout';

function buildDoubleHub(leafCount: number) {
  const nodes: GraphNodeInput[] = [{ id: 'A' }, { id: 'B' }];
  const edges: GraphEdgeInput[] = [];
  for (let i = 0; i < leafCount; i++) {
    nodes.push({ id: `L${i}` });
    edges.push({ source: 'A', target: `L${i}` });
    edges.push({ source: 'B', target: `L${i}` });
  }
  return { nodes, edges };
}

function buildStar(leafCount: number) {
  const nodes: GraphNodeInput[] = [{ id: 'H' }];
  const edges: GraphEdgeInput[] = [];
  for (let i = 0; i < leafCount; i++) {
    nodes.push({ id: `L${i}` });
    edges.push({ source: 'H', target: `L${i}` });
  }
  return { nodes, edges };
}

function run(label: string, nodes: GraphNodeInput[], edges: GraphEdgeInput[], budget: number) {
  if (global.gc) global.gc();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  const res = layoutGraph(nodes, edges, { timeBudgetMs: budget, seed: 42 });
  const wall = performance.now() - t0;
  const heapPeak = process.memoryUsage().heapUsed;
  const s = res.stats;
  console.log(
    `${label} n=${nodes.length} m=${edges.length} budget=${budget}ms | ` +
      `wall=${wall.toFixed(0)}ms (${((wall / budget - 1) * 100).toFixed(0)}% over) | ` +
      `phases: prep=${s.phaseMs.prepare.toFixed(0)} init=${s.phaseMs.initialize.toFixed(0)} ` +
      `forces=${s.phaseMs.forces.toFixed(0)} crossings=${s.phaseMs.crossings.toFixed(0)} ` +
      `overlap=${s.phaseMs.overlap.toFixed(0)} compose=${s.phaseMs.compose.toFixed(0)} | ` +
      `crossingsRemoved=${s.crossingsRemoved} budgetExceeded=${s.budgetExceeded} ` +
      `overlapPairs=${s.overlapPairs} | heapDelta=${((heapPeak - heapBefore) / 1048576).toFixed(0)}MB rss=${(process.memoryUsage().rss / 1048576).toFixed(0)}MB`,
  );
  return res;
}

// Claimed repro 1: double-hub, n=2001, m=3998 (under the m<=4000 gate)
{
  const { nodes, edges } = buildDoubleHub(1999);
  run('double-hub', nodes, edges, 600);
  run('double-hub', nodes, edges, 1200);
}

// Claimed repro 2: star, m=4000, zero real crossings (pure census waste)
{
  const { nodes, edges } = buildStar(4000);
  run('star      ', nodes, edges, 600);
}

// Control: same budget with refineCrossings disabled, to isolate the phase
{
  const { nodes, edges } = buildDoubleHub(1999);
  const t0 = performance.now();
  const res = layoutGraph(nodes, edges, { timeBudgetMs: 600, seed: 42, refineCrossings: false });
  const wall = performance.now() - t0;
  console.log(
    `control (refineCrossings=false) budget=600 | wall=${wall.toFixed(0)}ms ` +
      `crossingsPhase=${res.stats.phaseMs.crossings.toFixed(0)}ms`,
  );
}
