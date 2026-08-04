# The context graph: what it shows and how it is laid out

> **Update (Aug 2026): the folder view is now the default.** The graph opens as a
> map of per-type "folder" meta-nodes (People, Events, …) with counts, connected by
> aggregated edges weighted by underlying link count (`lib/context/folderView.ts`:
> `buildFolderView`). The map's backbone is a **ring of types**: folders link to
> each other in a circle with synthesized `types` edges (remapped aggregate
> folder-to-folder edges are dropped), and the fully-collapsed map uses a
> deterministic radial layout (`typeRingLayout`) matching that ring order —
> folders on one circle, sized-and-spaced by their footprint. Each folder branches
> **alias circles** via `alias` edges — one small circle per community-configured
> alias among its members (Founder ×5, Investor ×3, …), coloured by the alias
> config; unconfigured alias values (event URL slugs) never surface, same rule as
> `nodeTypeLabel`. Clicking a folder expands all its members; clicking an alias
> circle expands only that role; chips collapse either. The canvas is a **live
> force graph**: nodes are draggable (press + move past the click threshold pins
> the node to the cursor and reheats the d3 simulation, so neighbours react),
> with per-node collision radii (folder/alias/home/card footprints) and
> per-link-kind distances replacing the old fixed rectangle collide; a released
> drag settles and persists. Engine layouts seed structure changes; after a drag
> the live simulation's equilibrium owns the picture.
> **Every structure change is laid out by the engine below** — force-directed with
> the crossing-reduction pass — never by geometric insertion: `DirectoryContextView`
> passes seed (start) positions (`placeFolderView` — carried nodes start where they
> were, expanded members start bunched at their folder), `ContextWithTable` always
> runs `layoutContext` for the new structure, and `ContextCanvas` glides nodes from
> the seeds to the engine result (`targetPositions`, 700 ms cubic-out, then an
> animated camera refit). When a neighbourhood is revealed (search focus or a
> click selection), the revealed cluster's edges to folder/alias meta-nodes are
> cut from the **engine's input only** (`egoNodeId` prop on `ContextWithTable`;
> the drawn edges are untouched) — left attached, the engine strings the
> neighbours out toward their type folders; detached, the ego cluster is its own
> component and the degree-weighted repulsion fans the neighbours around the
> focused node. Layouts in this mode are session-local and deterministic
> per structure (engine seed = structure hash), so revisiting an expansion state
> reproduces the same picture; the server `ContextLayout` row is not used by the
> folder view. Search auto-expands the folder containing the best match. The
> hover/focus/path highlighting (typed edge colours, relationship labels, direction
> chevrons, shortest-path-on-hover) applies to whatever is visible.
> **Folders mode (the default).** A selector at the canvas's top right switches
> between **Folders** (default) and **Types** (the by-type map described above).
> Folders mode mirrors the brain's index-folder tree
> (`lib/context/brainView.ts`) and is laid out as a **deterministic radial tree
> expanding outwards** (`brainTreeLayout`) — never the force engine: top-level
> folders on the innermost ring in leaf-proportional wedges, an expanded
> folder's children fanning outward inside their parent's wedge, ring radii
> scaled together until the widest card fits its arc. An expanded folder KEEPS
> its node; children hang off it via `contains` edges. Entity context notes
> render as the real entity cards; other notes as small note circles
> (`drawNoteNode`; double-click opens the note). Only the containment tree
> draws at rest — mention edges (each note's resolved `linkTargets`) and the
> community's real entity links are carried as **`quiet` links** that the
> renderer shows only while focus/hover lights them, with hidden endpoints
> remapped to their collapsed ancestor folder (folder↔folder rollups drop).
> Tree + note metas load lazily (`/api/notes/tree`, `/api/notes`); search
> auto-expands the match's ancestor folders. **Clicking a node never
> restructures the graph** in either mode — a click only toggles the focus
> highlight in place (the old click-to-reveal was removed; search still
> reveals). Tests: `tests/brain-view.test.ts`.
> Sections below describe the underlying machinery and the pre-folder full-graph
> behaviour, which small communities and the engine itself still use.

This document describes the Visvine **context graph** (the "Context" / directory graph
view) end to end: what the picture is meant to communicate, where its nodes and edges
come from, how positions are computed, how they are cached and persisted, and how the
canvas draws and animates the result.

Everything below refers to code in `apps/web`. Key paths:

| Concern | Path |
| --- | --- |
| Graph data (server) | `lib/eventRepo.ts` (`getCommunityContextData`), `app/api/communities/[communityId]/context/route.ts` |
| Node/link semantics | `lib/context/entityNodes.ts`, `lib/context/links.ts`, `lib/context/relationships.ts`, `lib/context/normalize.ts`, `lib/context/featureVisibility.ts`, `lib/types/context.ts` |
| Layout engine | `lib/context/layout/` (`index.ts`, `prepare.ts`, `seed.ts`, `forces.ts`, `collide.ts`, `crossings.ts`, `pack.ts`, `compose.ts`, `quadtree.ts`, `rng.ts`, `types.ts`) |
| Layout orchestration (client) | `components/context/ContextWithTable.tsx`, `components/context/utils/incrementalLayout.ts` |
| Canvas + interaction | `components/context/ContextCanvas.tsx`, `components/context/renderers/*`, `components/context/utils/constants.ts` |
| Persistence | `components/context/hooks/useLayoutPersistence.ts`, `app/api/communities/[communityId]/context/layout/route.ts`, `ContextLayout` Prisma model |
| View entry point | `components/dashboard/DirectoryContextView.tsx` |
| Tests | `tests/context-layout.test.ts`, `tests/incremental-layout.test.ts` |

---

## 1. What the graph is meant to show

The context graph is the community's **memory rendered as a picture**: every thing the
community knows about, and every asserted relationship between those things, in one
spatial view.

The intent, concretely:

1. **One node per real thing.** Everything a user can create — a person, an
   organisation/community, an event, a resource, and (structurally) spaces, channels and
   connectors — is written into the `Node` table through a single path
   (`lib/context/entityNodes.ts::syncEntityNode`). That module exists precisely because
   call sites used to hand-write `prisma.node.create`, which is why communities, spaces
   and channels historically never appeared in the graph at all. If a thing exists in the
   product, it should be reachable in two places: as a graph node, and as a canonical
   markdown note in the community brain.

2. **One edge per asserted relationship.** All edges — manual links plus every automatic
   trigger (RSVP → `attended`, event host → `hosting`, intro → `introduced`, mention →
   `mentioned`, containment → `contains`, bulk import) — go through
   `lib/context/links.ts::upsertLink`. That gives one dedup rule
   (`communityId + pairKey + relationship`, where `pairKey` is the sorted, undirected
   `"minId|maxId"`) and one provenance model:
   - a `manual` write **promotes** an existing auto row in place (origin → `manual`,
     records `createdBy`), so a human assertion wins and never duplicates;
   - an auto write only refreshes `since`/`metadata` and **never** demotes a manual edge;
   - `removeAutoLink(communityId, origin, originRef)` can therefore never delete a human
     edge, because a promoted edge has origin `manual`.

3. **Structure legible at a glance.** The layout is intended to make the community's shape
   readable without reading any labels:
   - **clusters** = connected components — people and orgs that are actually linked sit
     together and are visibly separate from unrelated clusters;
   - **hubs** = well-connected nodes end up with visibly more space around them, because
     repulsion is weighted by degree, so a hub's leaves fan into a ring instead of
     crushing onto it;
   - **periphery** = isolated nodes (no edges at all) are pulled out of the simulation and
     placed as singletons around the outside of the cloud, so they read as "not yet
     connected" rather than as noise inside a cluster;
   - **no overlap, ever** — the layout guarantees zero card-on-card overlap, so nothing is
     hidden behind anything else;
   - **few crossings** — edge crossings are actively reduced when time allows, because a
     crossing reads as a relationship that isn't there.

4. **Stability across visits.** The layout is a *shared, per-community* artifact. Once
   computed, it is saved server-side and everyone restores the same picture (plus the same
   camera) on their next visit. A community's graph is meant to become a place you learn
   the shape of, not a picture that reshuffles every load.

### What is deliberately not shown

- **Structural node types are hidden by default.** `STRUCTURAL_NODE_TYPES` =
  `space`, `channel`, `note`, `file`, `connector` (`lib/types/context.ts`).
  `DirectoryContextView` filters them out before handing data to the graph
  (`isStructuralNodeType`). Everything creatable is a node — which is what makes the graph
  complete — and also what would bury the people in it. Containers stay out of the default
  view. (`note`/`file` are listed only so legacy rows never surface as grey unknowns;
  nothing writes them any more.)
- **Node types belonging to a switched-off tool.** `lib/context/featureVisibility.ts`
  filters nodes by `isNodeTypeEnabled(featureConfig, node.type)` and then drops any link
  whose endpoint disappeared (a dangling edge would otherwise draw into the origin).
  Nothing is deleted; the rows return in full when the tool is switched back on.
- **Draft and private events.** `fetchCommunityNodes` drops `event` nodes with
  `metadata.status === 'draft'` or `metadata.visibility === 'private'` — those are reached
  only by their own page or share link.

### Node and edge vocabulary

Node types (`DEFAULT_NODE_TYPES`, overridable per community) carry a colour and a shape,
and the shape decides the card geometry the layout reserves space for:

| Type | Colour | Shape | Card geometry |
| --- | --- | --- | --- |
| Person | `#2563eb` | rectangle | 140 × 215 |
| Community (an organisation *is* a community) | `#78d870` | square | 192 × (192 + 76 caption) |
| Event | `#ef4444` | rectangle | 140 × 215 |
| Resource | `#f59e0b` | rectangle | 140 × 215 |
| Space | `#0ea5e9` | square | square card |
| Channel | `#e0685f` | rectangle | 140 × 215 |
| Connector | `#6366f1` | rectangle | 140 × 215 |

`hexagon` is accepted and rendered as a square — the hexagon look was retired without a DB
migration, so stored `shape: 'hexagon'` still draws (and collides) as a square.

A node's **alias** (community-configured, type-scoped — e.g. Founder / Investor /
Government on a Person) overrides the base type colour on the card border, matching how
directory cards resolve colour.

Link types (`DEFAULT_LINK_TYPES`, overridable per community) are: Related, Knows,
Works at, Founded, Invested in, Member of, Partner, Mentors, and the system-owned
Attended, Hosting, Introduced, Mentioned, Contains. `system: true` marks the ones the
auto-flows own. Stored relationships are slugs (`works_at`); label/colour/directedness are
resolved through `getLinkTypeConfig`, which falls back to a neutral grey title-cased label
for unknown vocabulary rather than hard-failing.

**Note on the current renderer:** the canvas draws all edges in a uniform near-black at
low alpha and does not draw arrowheads — `directed` and per-type colour exist in the data
model and are used elsewhere, but the graph canvas currently renders relationship *type*
only implicitly. Parallel edges between the same pair are fanned apart with a quadratic
curve so they don't merge into one line.

---

## 2. Data flow, end to end

```
Prisma (Node, Link)
  └─ getCommunityContextData(communityId)            lib/eventRepo.ts
       └─ GET /api/communities/[id]/context          normalizeNode / normalizeLink
            └─ visibleGraph(nodes, links, featureConfig)      (tool gating)
                 └─ useCommunityContextData()        client hook
                      └─ DirectoryContextView        drops structural types,
                        │                            computes search focus + dimming
                        └─ ContextWithTable          chooses the position source
                             ├─ saved layout (server / session)   ← restore
                             ├─ placeIncrementally(...)           ← partial reuse
                             └─ layoutContext(...)                ← full engine run
                                  └─ ContextCanvas   d3-force (cold only), draw, camera,
                                                     interaction, persistence callbacks
                                       └─ PUT /api/communities/[id]/context/layout
```

Server freshness is governed by the `context-data-v2` cache tag, revalidated on every
node/link/event write (`bustContextCache()` in `entityNodes.ts` and `links.ts`). The HTTP
response itself is `Cache-Control: no-store` so no CDN caches a member-scoped graph.

Access control: the context route requires a session and rejects when
`communityReadForbidden` or `directoryAccessForbidden`. The layout route requires
membership to write (super-admins bypass).

---

## 3. Position sources — how `ContextWithTable` decides

`ContextWithTable` is the decision point. It computes a **structure hash** of the current
graph:

```ts
contextDataHash = sortedNodeIds.join(',') + '::' + sortedLinkPairs.join(',')
layoutHash      = `${LAYOUT_ALGO_VERSION}:${contextDataHash}`   // LAYOUT_ALGO_VERSION = 'v3'
```

The algorithm-version prefix is the invalidation lever: bumping `LAYOUT_ALGO_VERSION`
makes every previously saved layout fail to match, forcing one recompute with the current
engine, after which the fresh result is persisted under the new stamp. (v2 → v3 was the
switch from shelf-packing component boxes — which read as a rigid grid — to force-directed
circle packing.)

Then, in priority order:

1. **In-session drag positions** (`savedPositionsRef`) — cleared whenever the structure
   hash changes.
2. **Exact saved layout** (`serverSeed`): a layout persisted *this session* under the
   current `layoutHash`, else the mount-time server copy if its hash matches. Session
   layouts take precedence because the `initialLayout` prop is frozen at its mount-time
   fetch — after a structure round-trip (filter on → off) the stale copy would otherwise
   resurrect pre-drag positions.
   → the simulation is **frozen** and the saved camera transform is applied.
3. **Incremental reuse** (`placeIncrementally`, §6): no exact hash match, but some
   algo-compatible saved layout covers ≥ 70 % of the current nodes. Known nodes keep their
   position; new nodes are placed near their placed neighbours. Avoids ~1.5 s of blocked
   main thread.
   → frozen simulation, auto-fit camera, and the result is persisted once.
4. **Full engine run** (`layoutContext`, §4–5): cold start. Runs synchronously on the main
   thread with a 1.5 s budget.
   → frozen simulation, auto-fit camera, persisted once.
5. **Fallback scatter**: random points inside `seedRadius` (90). Only reachable if the
   engine somehow doesn't cover a node; in practice it never runs.

The engine is called with card-aware radii — each card is modelled by its **circumscribed
circle**, so "no circle overlap" implies "no card overlap":

```ts
rectR   = hypot(140, 215) / 2          ≈ 128.4
squareR = (192 / 2) * √2               ≈ 135.8
layoutContext(nodes, links, {
  width: 2000, height: 1400, padding: 0,
  nodePadding: 40,          // minimum clearance between card circles
  componentMargin: 150,     // clear space between clusters (~one card width)
  timeBudgetMs: 1500,
  seed: `${contextDataHash}:0`,   // deterministic per structure
})
```

The engine normalises into its 2000 × 1400 viewport; `ContextWithTable` divides
`stats.scale` back out and recentres on the origin so the canvas gets **world coordinates
at true card size**.

Note the `d3-force` simulation in `ContextCanvas` only actually runs on a genuine cold
start (`coldStart && incrementalLayout === null && engineLayout === null`) — which, given
the engine covers every node, is effectively never in the current wiring. Its physics
constants (`OBSIDIAN_PHYSICS`) still matter because they define `seedRadius` and all of
the fade/animation timings, and the force config remains the fallback path.

---

## 4. The layout engine — design and guarantees

`lib/context/layout/` is a self-contained, dependency-free TypeScript graph-layout engine.
It runs in browsers, workers and Node (the test suite drives it under `node:test`).

**Public API** (`index.ts`):

- `layoutContext(nodes, edges, options): LayoutResult` — synchronous; returns inside
  roughly `timeBudgetMs` (default 2500).
- `layoutContextAsync(nodes, edges, options): Promise<LayoutResult>` — yields to the event
  loop between work chunks (rAF in browsers, `setTimeout` elsewhere) so the UI thread never
  blocks, and emits paintable intermediate snapshots via `options.onProgress` (throttled to
  ~8/s). The first snapshot — a globally untangled PivotMDS approximation — typically
  arrives within a few hundred ms. *(Currently only the sync entry point is wired into the
  app; the async one is exercised by tests.)*

**Inputs**: `{ id, r? }` nodes and `{ source, target }` edges. **Output**:
`{ nodes: [{id, x, y, r}], edges, bounds, stats }`, where `r` is in output units — radii
are scaled together with positions during normalisation, so the zero-overlap guarantee
holds *exactly* at the reported radii.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `width` / `height` | 1200 / 800 | viewport normalised into |
| `padding` | 32 | inner padding kept clear |
| `nodeRadius` | 8 | fallback radius when a node has no `r` |
| `nodePadding` | 4 | minimum clearance between node borders |
| `idealEdgeLength` (K) | derived | natural spring length; see below |
| `timeBudgetMs` | 2500 | hard wall-clock budget for heavy stages |
| `seed` | derived | overrides the auto-derived deterministic seed |
| `gravity` | 0.15 | mass-proportional pull to each component's centroid |
| `refineCrossings` | true | run the greedy crossing-reduction post-pass |
| `maxUpscale` | 1.25 | cap on scaling a small graph *up* to fill the viewport |
| `componentMargin` | `max(0.75K, 24)` | clear space between neighbouring components |
| `onProgress` | – | snapshot callback (async path only) |

`K` (ideal edge length) is `max(48, 5·nodeRadius, 3.2·meanRadius + nodePadding)` unless
given. The headroom over `2·meanRadius` matters: without it, springs pulling toward `K` and
collision passes pushing to `≥ 2r̄` fight each other and edges thread through nodes. `K` is
hard-clamped away from 0/NaN because a zero `K` would zero the phyllotaxis spacing *and*
the quadtree's coincident-point jiggle, hanging the insert loop.

### Determinism

Every random draw flows through **one** seeded `mulberry32` PRNG, seeded from an FNV-1a
hash of the NUL-joined node ids (or `options.seed`). The algorithm is fully deterministic;
the *only* nondeterminism source is the wall-clock budget. So:

- if `stats.budgetExceeded === false`, the same input always produces the same layout —
  cacheable and screenshot-regression-testable;
- if it is `true`, a stage was truncated at a machine-load-dependent iteration and the run
  is **not** guaranteed reproducible — don't cache it, or raise `timeBudgetMs`.

### Guarantees

- **Zero node–node overlap** in the final output, at the reported radii. Enforced
  structurally (§5.4) and then *verified*: `stats.overlapPairs` counts residual overlapping
  pairs in the final layout and is expected to be 0.
- **Graceful degradation** under budget pressure: force refinement stops first, then the
  crossing pass is skipped; decomposition, initialisation, overlap removal and packing
  always run (they are cheap). A `timeBudgetMs: 0` run still returns a valid,
  non-overlapping layout.

### Reported stats

`elapsedMs`, `forceIterations`, `componentCount`, `isolatedCount`, `overlapPairs`,
`edgeCrossings` (`-1` = not computed: too large or out of budget), `crossingsRemoved`,
`scale`, `budgetExceeded`, and a `phaseMs` breakdown
(`prepare / initialize / forces / overlap / crossings / compose`).

---

## 5. The pipeline, stage by stage

Each stage is the budget-optimal pick from the graph-drawing literature; the citations live
inline in the source.

### 5.0 Prepare / decompose — `prepare.ts`

- Dedupe nodes by id (first occurrence wins → stable and deterministic). Radii are
  validated: non-finite or non-positive falls back to `nodeRadius`, absurd values are
  clamped to `1e7` (a single `r = Infinity` would poison the `K` derivation and spin the
  quadtree jiggle forever).
- Dedupe undirected edges, drop self-loops and dangling references. Key `a·n + b` (a < b)
  is unique and stays a safe integer for `n < 2²⁶`.
- Build CSR adjacency (both directions) — flat typed arrays, no object graph.
- **Union–find** (union-by-size + path halving, `O(m·α(n))`) → connected components. Each
  component gets its own local index space and its own CSR.
- Components are ordered **largest first** (so they get refinement budget first), ties
  broken by smallest member index — deterministic.
- **Isolated nodes** (components of size 1) are pulled out of the simulation entirely and
  rejoin as singleton circles during composition.

### 5.1 Initialize — `seed.ts`

Deterministic starting positions per component.

- **n = 2**: hard-coded at `±0.47K`.
- **n ≥ 40**: **PivotMDS** (Brandes & Pich, GD'06) — a sparse classical-MDS approximation
  giving globally untangled starts in `O(k(n+m) + k²n)` with `k = min(64, n)` pivots:
  1. pick pivots — first = max-degree, first half by max-min (k-center) for coverage, rest
     seeded-random (pure max-min over-samples the periphery and degrades, per the paper);
  2. BFS from each pivot → hop-distance matrix `Δ ∈ ℕ^{n×k}`;
  3. double-centre the squared distances;
  4. top-2 eigenvectors of the `k×k` matrix `CᵀC` by power iteration with deflation, then
     `x = C·v₁`, `y = C·v₂` (multiplying by `C` bakes in the singular values, so relative
     axis scaling is automatically right).

  The **absolute** scale of `C·v` is arbitrary, so it is anchored empirically: rescale so
  the component's mean edge length equals `K`. Without this the init can land hundreds of
  `K` wide and the step-capped integrator can't contract it in budget. Degenerate spectra
  (e.g. a star, where every leaf gets identical coordinates) bail out to phyllotaxis.
  Near-collinear output (paths) is *correct*, but gets a whisker of y-noise so the force
  stage can fan out instead of fighting symmetry.
- **Otherwise / on PivotMDS failure**: **phyllotaxis** (sunflower) placement — node *i* at
  radius `0.62K·√(i+0.5)`, angle `i · golden angle`. Deterministic, uniform density,
  collision-free disc. Nodes are placed in **BFS order from the highest-degree vertex**, so
  graph-adjacent nodes start spatially adjacent, which measurably cuts untangling
  iterations.
- **`jiggleCoincident`**: structurally equivalent vertices land on identical coordinates,
  and repulsion cannot act on a zero vector — exact ties get a deterministic whisker of
  noise.

This is the first paintable snapshot (`phase: 'initialize'`, progress 0.15).

### 5.2 Refine — `forces.ts` + `quadtree.ts`

Yifan Hu's spring-electrical model (GD'05) with ForceAtlas2-style degree masses:

```
attraction along edges:   F_a(d) = d²/K              (toward the neighbour)
repulsion between nodes:  F_r(d) = C·K³·m_u·m_v / d² (away),  m = deg + 1,  C = 0.2
gravity per node:         F_g    = g·K·m_u           (toward the component centroid)
```

- **Why `1/d²` and not the classic `1/d`**: Hu's "general model" with `p = 2` (Graphviz's
  `repulsiveforce`). Long-range `1/d` pressure warps the periphery of sparse structures —
  an n-cycle inflates to ~3× its natural radius under `p = 1`, because every pair
  contributes a constant outward radial force. Under `p = 2` distant pairs decay and a
  40-cycle settles at its natural circle.
- **Gravity** supplies the remaining compaction (constant-magnitude, mass-proportional,
  ForceAtlas2's `k_g·(deg+1)`), ramped linearly to zero inside `0.5K` of the centroid so
  the constant-force field has no discontinuity at the centre. Equilibrium for an isolated
  edge of degree-1 nodes: `d ≈ 0.95K` without gravity, `≈ 0.87K` with the default.
- **The `(deg+1)(deg+1)` mass product** is what makes hub neighbourhoods claim area
  proportional to degree, so leaf fans spread into rings instead of crushing into the hub —
  the classic hub pathology, and one of the things the picture is *supposed* to show.
- **Barnes–Hut** approximation, opening criterion `cellWidth / distance ≤ θ` with
  `θ = 1.1` → `O(n log n)` per iteration. The quadtree is a flat-array structure: cell `c`
  owns `children[4c..4c+3]`; a slot holds `-1` (empty), a cell index (≥ 0), or an encoded
  leaf `-(nodeIndex+2)`. Cells are created top-down so child index > parent index, which
  lets mass / centre-of-mass / max-radius aggregation run as one reverse-order sweep
  instead of an explicit post-order traversal. Insertion jiggles-and-restarts on coincident
  points or depth overflow (`QT_MAX_DEPTH = 32`).
- **Integration** is Hu's normalised scheme — each node moves exactly `step` along its net
  force direction — with his adaptive controller (`t = 0.9`): five consecutive energy
  decreases ⇒ `step /= 0.9` (accelerate); any energy increase ⇒ `step *= 0.9` (back off).
  Convergence at `step < 0.01K`; since every node moves exactly `step`, the step *is* the
  per-node movement bound.
- **One refinement over Hu**: per-node oscillation damping. A node whose net force reversed
  direction since the last sweep (negative dot product with its previous force) is
  oscillating around equilibrium and moves at half step. This kills the shimmer Hu's
  uniform step causes in converged regions while distant regions still move. It is a cheap
  stand-in for ForceAtlas2's swinging/traction machinery.
- **Iteration schedule** by component size: 300 (n ≤ 100), 240 (≤ 500), 180 (≤ 1500),
  140 (≤ 4000), else 100 — split ~55 % pure force, ~45 % force + collision. Each component
  gets a deadline proportional to its share of the remaining work, all bounded by
  `t₀ + 0.72·budget`.

Runs as a **generator** so the async driver can yield to the event loop mid-simulation
(it yields every 10 iterations) and emit progress snapshots.

### 5.3 Polish — `crossings.ts`

Two things live here, both optional and both time-boxed.

**PrEd node–edge repulsion** (Bertault, GD'00), applied during the last ~12 force
iterations for components with ≤ 2500 edges. A vertex closer than `γ = 3r` to a
non-incident edge is pushed off the edge's supporting line with magnitude `(γ−d)²/d` —
quadratic in penetration depth, singular at contact. This kills the worst perceptual defect
short of overlap: an edge grazing through an unrelated node, which reads as a relationship
that isn't there. The degenerate on-the-line case pushes perpendicular *toward the side the
node is actually on* (a fixed side would shove nodes through the edge).

**Greedy vertex-move crossing reduction** (the practical scheme of Demel et al. GD'18 /
Radermacher & Rutter ESA'19), run after the force stage if `now < t₀ + 0.75·budget`, until
`t₀ + 0.9·budget`, skipping components with > 4000 edges:

- census the crossings, score each vertex by crossings on its incident edges, take the
  worst ≤ 160 (excluding hubs with degree > 64 — moving a degree-*d* vertex costs
  `O(d · cell density)` per candidate, and hub crossings are usually load-bearing structure,
  not accidents);
- sample 12 candidate positions in each of two shrinking squares (side `3K`, then `0.8K`);
- reject candidates that would overlap a node (uniform node hash grid);
- count only the crossings of the vertex's **own** incident edges (grid-local, so a move is
  ~`O(deg)`), and accept strictly-improving moves;
- maintain the segment grid honestly on accept — re-rasterise the moved vertex's incident
  edges.

Exact crossing minimisation is NP-hard and APX-hard; this is the published cost-effective
heuristic family for a time-boxed post-pass.

Both are backed by a **uniform-grid segment index**: cells keyed on a dense integer
lattice, each segment registered in every cell it passes through via an Amanatides–Woo
voxel walk, cell size ≈ `K` (edges average ~`K` long, so most occupy a handful of cells).
Expected `O(m + X)` versus Bentley–Ottmann's `O((m+X) log m)` and its robustness
engineering. Crossing tests use the standard orientation predicate and count **proper**
(interior) crossings only — edges sharing a vertex are rejected before the dedup set is
touched, both because they can never properly cross and because a degree-*d* hub would
otherwise put `C(d,2)` pairs into V8's Set and blow its ~2²⁴ cap.

### 5.4 Separate — `collide.ts`

Two mechanisms, soft then hard.

**`collidePass`** — one Gauss–Seidel circle-collision sweep, d3-forceCollide style: every
overlapping pair is displaced apart along the centre line, split by mass (`r²`) so small
nodes yield and big nodes hold their ground. `strength < 1` blends corrections to avoid
alternating-overshoot shimmer; strength ramps `0.5 → 1.0` across the collision phase of the
force run. Pairs are visited exactly once via the quadtree leaf-ordering trick (`j > i`).
After the force stage, up to 3 full-strength sweeps run (stopping early when one resolves
nothing).

**`stackingPass`** — the hard guarantee. Process nodes in ascending-*y* order; each node may
only be pushed **down** (+y) until it clears every already-placed node. For a placed node
*u* with `|x_u − x_v| < r_u + r_v + gap`, clearance requires

```
y_v ≥ y_u + √((r_u + r_v + gap)² − (x_u − x_v)²)
```

Earlier nodes never move again and pushes are monotone, so by induction the result has
**zero** overlapping pairs — something soft relaxation can never promise. x-coordinates and
the vertical order are preserved, so a post-collide layout is distorted minimally (usually
not at all: a non-overlapping input passes through unchanged). x-bucketing keeps each query
local, `O(n · local density)`. The total downward shift is averaged back out at the end so
the pass doesn't bias the bounding box downward.

**`countOverlaps`** then verifies the *final* composed layout via a uniform grid, and the
result lands in `stats.overlapPairs`.

### 5.5 Compose — `pack.ts` + `compose.ts`

Components are reduced to bounding circles (content radius + `componentMargin/2`, so
tangent circles leave a full margin of clear space between contents). Isolated singletons
are appended *after* the connected components with a much tighter half-gap
(`nodePadding·0.5 + 2`) — their neighbours are usually other singletons, and full component
margin would read as scattered confetti.

`packCircles` then:

1. **Seeded Fisher–Yates shuffle** of the connected components (isolated stay last). Any
   sorted order — the old tallest-first shelf sort especially — lines same-sized components
   up next to each other, which reads as artificial. The shuffle is what makes the cloud
   look organic. Isolated singletons stay last so they seed on, and remain on, the
   periphery — echoing the "not yet connected" ring.
2. **Phyllotaxis seeding** with ×1.35 head-room (radius follows cumulative area ⇒ roughly
   uniform density), so relaxation compacts *inward* (which settles cleanly) rather than
   exploding outward.
3. **Relaxation**: 64 iterations (24 for > 1500 circles) of proportional contraction toward
   the origin (gravity `0.092 → 0.012`) against Gauss–Seidel circle collisions (strength
   `0.5 → 1.0`). The collision machinery is reused verbatim by wrapping the circles in a
   dummy `Component`.
4. **Hard separation**: up to 400 full-strength sweeps until one resolves nothing. Every
   80th sweep inflates all positions by 4 % — positions scale, radii don't, so any residual
   jam loosens. That escape valve is what makes termination certain.

Disjoint bounding circles ⇒ no node overlap *across* components, so composition can't break
the intra-component guarantee.

`composeLayout` then places each component's local coordinates at its packed circle centre,
computes tight content bounds (including radii), and applies a **uniform** scale
`min(availW/bw, availH/bh, maxUpscale)` about the viewport centre. Radii are scaled by the
same factor, which is exactly why zero-overlap survives normalisation.

### Pipeline budget split

| Boundary | Fraction of `timeBudgetMs` |
| --- | --- |
| force refinement deadline | 0.72 |
| crossing pass entry gate | 0.75 |
| crossing pass deadline | 0.90 |
| final crossing-count stats deadline | 1.20 |

Overlap removal and composition are unconditional — they are cheap and they carry the
guarantee.

---

## 6. Incremental layout — `incrementalLayout.ts`

When the structure changed only a little (a few members joined or left, or a filter
narrowed the node set), re-running the full engine wastes ~1.5 s of blocked main thread and
reshuffles a picture the user already knows. `placeIncrementally` reuses the best
algo-compatible saved layout instead:

- Split ids into **known** (present in the saved layout) and **unknown**. If coverage
  `< minCoverage` (default 0.7), return `null` — the caller falls back to the full engine.
- Known nodes keep their exact saved positions and are inserted into a spatial hash
  (cell = `MIN_DIST = hypot(140, 215) + 24 ≈ 281`; two card centres that far apart can never
  overlap, since overlap requires `|dx| < W` **and** `|dy| < H`).
- Each unknown node is desired at the **centroid of its already-placed neighbours**; a node
  with no placed neighbours goes on a ring just outside the existing cloud
  (`maxR + 1.5·CELL`) at a deterministic per-id hashed angle.
- A **golden-angle spiral probe** (up to 600 steps, radius `0.6·CELL·√i`) from the desired
  point finds the first collision-free spot, so incremental placement also never overlaps.
  Deterministic: same ids + same saved layout ⇒ same result.

The candidate saved layout is chosen by **coverage** — across all session layouts plus the
mount-time server copy, whichever contains positions for the most of the current nodes
wins (skipping any whose hash doesn't carry the current `LAYOUT_ALGO_VERSION` prefix).

---

## 7. Persistence

**Model**: `ContextLayout`, one row per community, holding `{ hash, transform, positions }`.
It is a *shared, per-community canonical layout* — members collaboratively shape it and
every member restores it.

**API**: `app/api/communities/[communityId]/context/layout/route.ts`

- `GET` → the saved layout or `null` (`Cache-Control: private, max-age=5`).
- `PUT` → upsert; requires community membership (super-admins bypass). Validation is
  deliberately forgiving where forgiveness is cheap:
  - an unusable camera transform falls back to identity rather than 400-ing, because the
    positions are the expensive part of the payload;
  - individual malformed position entries are dropped rather than failing the write — one
    member's stale node id must not lose everyone's layout;
  - hard cap of 20 000 positions, since the row is read back into every member's browser.

**When we persist** (`useLayoutPersistence`):

- `markDirty()` — a cold run or a drag changed the layout; the next settle should persist.
- `flushOnSettle(positions, transform)` — called when the simulation settles; persists once
  *iff* dirty, then clears the flag. A frozen server restore is never re-persisted.
- `schedulePersist(getPositions, getTransform)` — 1 s debounce for camera-only changes
  (pan/zoom) that don't restart the simulation.

`persistOnRestore` is set exactly for the two cases where the client produced a layout the
server has never seen (fresh engine run, incremental placement): the canvas fits the camera
on the next rAF and then writes the layout + camera once. `DirectoryContextView`
fire-and-forgets the `PUT` (the canvas already debounces) and mirrors the result into a
module-level per-community `layoutCache`, so navigating away and back restores instantly
without a refetch.

---

## 8. Rendering, camera and interaction — `ContextCanvas.tsx`

A single `<canvas>`, high-DPI aware (`devicePixelRatio` backing store), with a manual
`{x, y, k}` camera transform kept in a ref (not state) so pan/zoom never triggers a React
re-render. Renders are rAF-deduped through `scheduleRender()`.

**Level of detail** by zoom (`transform.k`), ~ card widths of 77 px and 31 px on screen:

| LOD | Threshold | Draws |
| --- | --- | --- |
| `full` | `k ≥ 0.55` | image (fetched on demand), name, subtitle, type tag, glow |
| `mid` | `k ≥ 0.22` | image + name only; no shadow/glow, no gradient placeholder |
| `low` | below | flat coloured silhouette — what makes a zoomed-out graph cheap to pan |

**Culling**: nodes outside the viewport (padded by 1.5 × the larger card dimension) are
skipped; links whose endpoints are both past the same viewport edge are skipped (such a
segment can't cross the viewport).

**Other draw-loop details**: the CSS theme is resolved once per frame, not once per node
(`getComputedStyle` per card per frame was a measurable cost). Drawing is suppressed until
the initial camera fit has happened, so links don't flash at the canvas origin.

**Edge labels**: lit edges carry a relationship pill placed at the midpoint of the
*visible* part of the edge — the segment clipped to the two card boundaries — and the
pills are drawn in a separate pass **after** the node cards (`drawLinks` returns
`PendingLabel[]`; the canvas calls `drawEdgeLabels` last), so a card can never hide a
label.

**Focus and dimming**: search (`DirectoryContextView`) computes a best-match node id
(`findBestMatchingNodeId`, weighted name > subtitle > id > location > tags) and a set of
non-matching ids. A focused node and its direct neighbours stay bright; everything else
drops to alpha 0.15, and focus edges darken and thicken. Clicking a node toggles the same
focus locally; clicking empty canvas clears it. External focus (search/URL) also
auto-zooms to `k = 1.5`.

**Intro animation**: nodes fade in over 700 ms with an 8 ms per-node stagger and a 26 px
upward rise — a draw-time offset only; `node.x/y` and the persisted layout are never
touched. The stagger is compressed so the whole cascade fits in 1.5 s regardless of node
count (otherwise a 1000-node community would redraw the full canvas for 8+ seconds). Since
a restored layout freezes the simulation (it would render one frame), a dedicated rAF pump
drives the fade. `prefers-reduced-motion` skips the tween entirely and paints the graph
static.

**Camera**: `fitToScreen` frames the whole graph with 200 px padding, capped at `k = 1.2`.
The wheel zoom-out floor is derived from the graph's *current* bounds on every wheel tick
(`min(0.05, fitZoom·0.8)`) — otherwise a camera restored from a saved layout, where
`fitToScreen` never ran, would trap large graphs zoomed in with no way back out. Max zoom
is 8. Zoom is cursor-anchored. Refits happen only on **real** container resizes, never on
the initial measurement — refitting on mount used to silently discard the restored camera.
`ctrl+wheel` is swallowed window-wide while the graph is mounted, because a trackpad pinch
whose centroid lands on surrounding chrome would zoom the whole *page*, and scrolling over
the canvas can't undo browser page zoom.

**Interaction**: nodes are **static** — a press never moves a node. Within 5 px of travel a
press resolves to a click (select/toggle focus); beyond that it pans. Double-click opens the
node's detail page (`/events/<id>` for events, `/directory/<id>` otherwise). Right-click on
a node raises `onNodeContextMenu`. Hover prefetches the node profile.

**Images** are warmed in chunks of 8 only once the browser is idle
(`requestIdleCallback`, 4 s timeout, else a 2.5 s `setTimeout`) — on large communities,
eagerly fetching hundreds of photos at mount competes with the graph payload and first
paint. Zoomed-out views don't draw photos at all; anything visible at readable zoom loads
on demand during draw, and `onImageLoad` triggers a rAF-deduped repaint as each arrives.

---

## 9. Tests

- `tests/context-layout.test.ts` covers the engine: empty/singleton graphs, the two-node
  case, viewport normalisation and bounds, zero overlap on dense/star/path/cycle inputs,
  determinism (same input twice ⇒ identical output; same explicit seed ⇒ identical, different
  seed ⇒ different), the `timeBudgetMs: 0` degradation path, and the async progress-snapshot
  contract.
- `tests/incremental-layout.test.ts` covers `placeIncrementally`: coverage threshold,
  preservation of known positions, non-overlap of newly placed nodes, determinism.

Run them with `pnpm test` (do **not** run `next build` while the dev server is running —
it clobbers `apps/web/.next`; use `pnpm typecheck` / `pnpm lint` to verify instead).

---

## 10. Tuning cheatsheet

| Symptom | Knob |
| --- | --- |
| Clusters too far apart / too much whitespace | `componentMargin` in `ContextWithTable` (currently 150) |
| Cards too tightly packed within a cluster | `nodePadding` (currently 40), or `idealEdgeLength` |
| Layout takes too long on large communities | `timeBudgetMs` (currently 1500); check `stats.budgetExceeded` |
| Too many edge crossings | raise `timeBudgetMs`, or ensure `refineCrossings` stays true |
| Sparse structures (cycles/paths/trees) inflate | `gravity` (default 0.15) |
| Layout must change for everyone after an engine change | bump `LAYOUT_ALGO_VERSION` in `ContextWithTable.tsx` |
| Card geometry changed | update `CARD_DIMENSIONS`; the engine radii (`rectR`, `squareR`) and `MIN_DIST` derive from it |
| Graph reshuffles too eagerly on small membership changes | `minCoverage` in `placeIncrementally` (default 0.7) |
| Zoomed-out panning is slow | `LOD_THRESHOLDS` |
