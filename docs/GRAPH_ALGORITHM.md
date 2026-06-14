# Graph Layout & Rendering Algorithm

How Visvine turns a community's `{ nodes, links }` into the interactive node/link
graph you see on screen. The product surface is a force-directed graph of cards
(people, orgs, events, …) connected by relationship links, rendered to a canvas.

There are **two distinct layout systems** that hand off to each other:

1. A **deterministic offline layout engine** (`lib/graph-layout/graphLayout.ts`)
   that computes a good static arrangement once, off the simulation loop.
2. A **runtime d3-force simulation + canvas renderer** (`components/graph/CustomForceGraph.tsx`)
   that draws the graph, handles interaction, and *optionally* runs a live
   simulation "burst" on a cold start.

The key design choice: **the graph does not continuously simulate.** Positions
are precomputed (or restored from a saved layout), and dragging a node moves only
that node — the simulation is **never reheated** on interaction. This avoids the
"jelly" wobble of neighbours shifting every time you grab a card.

---

## File map

| File | Role |
| --- | --- |
| `lib/graph-layout/graphLayout.ts` | Deterministic offline layout engine (PivotMDS → Barnes-Hut → overlap removal → component packing) |
| `components/graph/CustomForceGraph.tsx` | Canvas renderer, d3-force runtime, interaction (drag/pan/zoom/focus) |
| `components/graph/GraphWithTable.tsx` | Picks the layout *source* (server seed / incremental / engine / fallback), builds sim nodes |
| `components/graph/DirectoryGraphView.tsx` | Fetches graph data, applies semantic/text search filtering |
| `components/graph/utils/constants.ts` | All tuning constants (`CARD_DIMENSIONS`, `LOD_THRESHOLDS`, `OBSIDIAN_PHYSICS`) |
| `components/graph/utils/forceRectCollide.ts` | Custom rectangular collision force for cards |
| `components/graph/utils/incrementalLayout.ts` | Reuse a saved layout and place only new nodes |
| `components/graph/hooks/useLayoutPersistence.ts` | Debounced persistence of positions + camera |
| `components/graph/renderers/*` | Per-shape node renderers + link renderer (LOD-aware) |
| `app/api/communities/[communityId]/graph/layout/route.ts` | GET/PUT saved layout (positions + camera) |

---

## Data flow at a glance

```
API/DB: { nodes, links }
   │
   ▼
DirectoryGraphView ── fetch + semantic/text-search filtering
   │
   ▼
GraphWithTable ── compute structure hash, then choose a layout SOURCE:
   ├─ server seed?      (hash + algo version match)  → restore positions + camera
   ├─ incremental?      (≥70% of nodes already placed) → reuse + place new nodes
   ├─ engine layout?    (fresh)                         → layoutGraph(...)
   └─ fallback          (rare)                          → random scatter in seedRadius
   │
   ▼
simNodes (x/y + spawn metadata)
   │
   ▼
CustomForceGraph ── canvas render loop + interaction
   ├─ cold start? → run a short live d3-force burst, then freeze
   ├─ warm?       → freeze sim, apply saved camera, fade nodes in
   └─ on settle / on drag / on pan-zoom → persist (debounced)
   │
   ▼
API PUT: { hash, transform, positions }
```

---

## 1. The offline layout engine (`graphLayout.ts`)

`layoutGraph(nodes, links, options)` is a deterministic, time-budgeted pipeline.
Given the same input it produces the same output (unless the time budget is
exceeded), which is what makes the result cacheable and consistent across
sessions. Determinism comes from a seeded `mulberry32` PRNG keyed off an FNV-1a
hash of node IDs (or `options.seed`).

### Preprocessing

- Deduplicate nodes and edges; drop self-loops and dangling references.
- Build a **CSR (compressed sparse row)** adjacency list for cache-friendly
  traversal, plus a per-node degree array (used for mass-weighted repulsion).

### Stage 1 — DECOMPOSE

Union-find splits the graph into connected components. Isolated (degree-0) nodes
are pulled out for separate peripheral placement so they don't pollute the force
field of the connected core.

### Stage 2 — INITIALIZE (PivotMDS)

Rather than starting from random positions, each component is seeded with a
**Pivot MDS** (classical multidimensional scaling) approximation:

- Pick `k = min(64, n)` pivot nodes.
- BFS hop-distance from each pivot → sparse distance matrix.
- Double-centre the matrix and run power iteration to extract the top two
  eigenvectors → 2-D coordinates.
- Rescale so the **mean edge length** matches the ideal length `K`.

This gives the force refinement a near-final starting point, so it converges in
far fewer iterations than a random start.

### Stage 3 — REFINE (Barnes-Hut force simulation)

Hu's spring-electrical model:

- **Attraction** along edges: `F = d² / K`
- **Repulsion** (all pairs, degree-weighted masses): `F = C · K³ · mᵤ · mᵥ / d²`,
  with `C_REP = 0.2`.
- Repulsion is computed with a **quadtree / Barnes-Hut** approximation
  (opening criterion `θ = 1.1`), giving `O(n log n)` instead of `O(n²)`.
- **Hu's adaptive step controller**: per-node movement is capped at a `step`
  distance along the net force direction. The step length accelerates after 5
  consecutive energy decreases and backs off on an energy increase. Per-node
  oscillation damping halves the step for nodes bouncing around equilibrium.

### Stage 4 — SEPARATE (guaranteed overlap removal)

Two passes:

- Gauss-Seidel circle-collision relaxation inside the final force iterations.
- A deterministic **scan-line stacking** pass: process nodes in ascending-y
  order and push each one down until it clears all earlier nodes. This is a
  *hard* zero-overlap guarantee (it preserves x-coordinates and y-ordering), so
  no two cards can end up hidden behind each other.

### Stage 5 — POLISH (edge-crossing reduction)

If time remains in the budget, a greedy vertex-move pass reduces edge crossings,
using a uniform-grid segment index to find crossing pairs quickly. Skipped
entirely when the budget is exhausted.

### Stage 6 — COMPOSE (component packing)

Each component's bounding circle is packed into the viewport with a
force-directed circle-packing step: phyllotaxis (golden-angle spiral) seeding +
centre-gravity + circle-collision relaxation, then uniform scaling into the
requested width/height.

### Time budget & graceful degradation

`timeBudgetMs` (default 2500ms; the UI passes **1500ms** for snappier loads)
bounds the whole pipeline. Under pressure it degrades in order: refinement stops
first, crossing reduction is skipped next. If the budget is exceeded the result
sets `budgetExceeded = true` (and is no longer guaranteed identical run-to-run).

Engine options passed from `GraphWithTable.tsx`:

```ts
layoutGraph(nodes, links, {
  width: 2000,
  height: 1400,
  padding: 0,
  nodePadding: 40,
  componentMargin: 150,                     // ~1 card width between components
  timeBudgetMs: 1500,
  seed: `${graphDataHash}:${rerollNonce}`,  // deterministic; reroll forces a fresh seed
});
```

---

## 2. The runtime simulation & renderer (`CustomForceGraph.tsx`)

### d3-force setup

When the graph cold-starts (no usable saved/precomputed layout, or an explicit
re-run), a short live `d3-force` simulation runs to settle the burst. Forces
(from `OBSIDIAN_PHYSICS`):

| Force | Value | Notes |
| --- | --- | --- |
| `forceLink` distance / strength | 800 / 0.4 | ideal edge length |
| `forceManyBody` (charge) | −4200, dist 60–4500 | node repulsion, clamped to avoid singularities |
| `forceX` / `forceY` | 0.025 | soft pull toward origin |
| `rectCollide` | gap 120, strength 0.45 | rectangular card collision (see below) |
| `isolatedRing` | mult 2.6, strength 0.3 | parks degree-0 nodes on a periphery ring |

Cooling: `alpha = 1`, `alphaDecay = 0.018`, `alphaMin = 0.001`,
`velocityDecay = 0.32` (friction). The canvas is held blank for
`ticksBeforeReveal = 6` ticks before showing the first frame, so the user never
sees the initial chaotic burst.

**No reheat on interaction.** Once settled (or when restoring a saved layout),
the simulation is frozen. This is the central behavioural contract of the graph.

### Rectangular collision (`forceRectCollide.ts`)

d3's built-in collision is circular; cards are 140×215 rectangles, so there's a
custom force:

- Spatial hash (cell ≈ 2.5× card half-extent) → `O(n)` neighbour lookups.
- 8 Gauss-Seidel relaxation iterations per tick.
- Overlapping pairs are pushed apart along the axis of *minimal* overlap, split
  by mass (`r²`). `strength = 0.45` resolves a fraction of the overlap per
  iteration so simultaneous corrections blend smoothly.

### Card geometry

```
CARD_DIMENSIONS = { WIDTH: 140, HEIGHT: 215, IMAGE_HEIGHT: 105,
                    BORDER_WIDTH: 4, PADDING: 12, TAG_HEIGHT: 20 }
```

Node shapes by type: `RectangleNodeRenderer` (person/investor/event/group),
`HexagonNodeRenderer` (org/startup, ~75% of card size), `CircleNodeRenderer`
(custom types). Links: straight by default, gentle quadratic curves for parallel
edges (`LinkRenderer.ts`).

---

## 3. Level of detail (LOD) — why it stays fast

On-screen card width is `transform.k × 140`. The renderer picks a LOD per frame:

```
k ≥ 0.55  → 'full'   image + name + subtitle + type pill + glow/shadow
k ≥ 0.22  → 'mid'    image + name only; no shadow, no gradient placeholders
k <  0.22 → 'low'    flat coloured silhouette; no image, no text, no shadow
```

`low` LOD does **zero image fetches, no text layout, and no shadow blur**, which
is what keeps a fully zoomed-out pan interactive at 1000+ nodes.

Other render-loop optimisations:
- **Viewport culling**: links with both endpoints off-screen are skipped; nodes
  outside the viewport aren't drawn.
- **Image cache** (`imageCache.ts`): images preload on browser idle
  (`requestIdleCallback`, 2.5s timeout) in chunks of 8 when zoomed out, so first
  paint isn't blocked; full-LOD cards fetch on demand during draw.

### Fade-in animation

New nodes fade in (700ms) and "rise" 26 graph-units into place, staggered by 8ms
per node. The total stagger is capped at `fadeInMaxTotalStaggerMs = 1500` (spawn
indices are compressed at stamp time) so a 1000-node graph doesn't redraw the
whole canvas for 8+ seconds. The rise is applied in the canvas transform only —
**persisted positions are never moved by the animation**. Honours
`prefers-reduced-motion` (instant display).

---

## 4. Choosing a layout source (`GraphWithTable.tsx`)

Per structure change, the component computes a **structure hash**
(version-prefixed, e.g. `v3:node1,node2::link1-2`) and picks the cheapest valid
source, in priority order:

1. **Session layouts** (in-memory) — in-session drags take precedence over the
   server copy.
2. **Server seed** — reusable only while `hash` *and* the algo version still
   match the current structure.
3. **Incremental reuse** (`incrementalLayout.ts`) — keep saved positions for
   existing nodes and place only new ones (see below). Used when ≥ 70% of nodes
   already have a saved position; avoids a ~1.5s main-thread engine run.
4. **Full engine** — `layoutGraph(...)` from scratch.
5. **Fallback** — random scatter within `seedRadius = 90` (rare; only if the
   engine produces nothing).

The "Re-run layout" button bumps `rerollNonce`, changing the engine seed to
force a fresh arrangement.

### Incremental placement

`placeIncrementally(nodeIds, links, saved, minCoverage = 0.7)`:

- Existing nodes keep their saved positions unchanged.
- A new node is placed near the centroid of its already-placed neighbours (or on
  the periphery ring if isolated), then nudged outward along a **golden-angle
  spiral** until it clears everything (collision checked via a grid spatial
  index). `MIN_DIST` between card centres ≈ `√(w² + h²) + 24 ≈ 281px`.
- If coverage < `minCoverage`, it returns `null` → triggers a full engine run.

---

## 5. Persistence (`useLayoutPersistence.ts` + layout API)

Saved layout shape:

```ts
interface GraphLayoutData {
  hash: string;                                   // structure hash (incl. algo version)
  transform: { x: number; y: number; k: number }; // camera pan/zoom
  positions: Record<string, { x: number; y: number }>;
}
```

Three persistence modes:

- `markDirty()` — flag that the layout changed (cold start or drag).
- `flushOnSettle(...)` — write once the simulation settles, only if dirty.
- `schedulePersist(...)` — **1000ms debounce** for camera-only changes (pan/zoom)
  that don't touch positions. Rapid drags/pans coalesce into one write.

API: `app/api/communities/[communityId]/graph/layout/route.ts`
- `GET` returns the saved layout or `null` (`Cache-Control: private, max-age=5`).
- `PUT` upserts (community members + super-admins only); validates ≤ 20,000
  nodes per layout.

On load, the saved `positions` seed the sim nodes and the saved `transform`
restores the camera, so a returning user sees the exact same arrangement and
zoom without recomputing.

---

## 6. Interaction model

- **Drag** — press on a node starts a *candidate*; once the pointer moves past
  `DRAG_THRESHOLD = 5px` the node is pinned (`fx/fy = x/y`) and follows the
  cursor. **The simulation is not reheated** — only that node moves. On release
  it's unpinned and the new position is persisted (1s debounce).
- **Pan** — press on the background.
- **Zoom** — wheel → exponential (`factor = exp(delta × −0.005)`), clamped to
  `0.05×–8×`, keeping the point under the cursor fixed.
- **Focus / auto-zoom** — an external focus (from search or a URL) auto-zooms to
  1.5× on the node with cubic-out easing over 600ms. A plain click-selection
  does *not* auto-zoom.

---

## 7. Search & filtering (`DirectoryGraphView.tsx`)

- Data comes from `useCommunityGraphData()` → `{ nodes, links }`.
- **Semantic search** filters `nodes`/`links` to the matched subset. This
  filtered view is **not persisted** — clearing the filter restores the full
  saved layout.
- **Text search** dims unmatched nodes (opacity ~0.15) rather than removing them.

Semantic search itself (server side) expands the query via
`lib/ai/queryParser.ts` and ranks nodes with the `match_nodes` pgvector function
against `Node.embedding` (1536-dim, OpenAI `text-embedding-3-small`). That
affects *which* nodes show, not where they're placed.

---

## Why it's built this way — recap

1. **Precompute, don't simulate live.** A deterministic engine + frozen runtime
   means stable, repeatable layouts and no neighbour wobble on drag.
2. **Deterministic + cacheable.** Same input → same layout → safe to persist and
   restore across sessions.
3. **Aggressive LOD + culling.** Zoomed-out panning stays smooth at 1000+ nodes
   because low detail skips images, text, and shadows.
4. **Hard zero-overlap guarantee.** The scan-line stacking pass mathematically
   prevents hidden, overlapping cards.
5. **Cheap structure changes.** Incremental reuse places only new nodes instead
   of recomputing the whole graph.
