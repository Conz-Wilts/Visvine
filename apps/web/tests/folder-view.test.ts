import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFolderView,
  placeFolderView,
  typeRingLayout,
  folderIdForType,
  isFolderNodeId,
  aliasNodeId,
  aliasExpansionKey,
  isAliasNodeId,
  folderCount,
  folderRadius,
  aliasRadius,
  pluralTypeLabel,
} from "../lib/context/folderView";
import type { ContextData, NBNode } from "../lib/types";

const node = (id: string, type: string, name = id): NBNode => ({ id, type, name });

const fixture = (): ContextData => ({
  nodes: [
    node("person:a", "person"),
    node("person:b", "person"),
    node("person:c", "person"),
    node("event:x", "event"),
    node("community:h", "community"),
  ],
  links: [
    { source: "person:a", target: "event:x", relationship: "attended" },
    { source: "person:b", target: "event:x", relationship: "attended" },
    { source: "person:a", target: "person:b", relationship: "knows" },
    { source: "person:c", target: "community:h", relationship: "member_of" },
  ],
});

// ── buildFolderView: grouping ────────────────────────────────────────────────

test("fully collapsed: one folder per type with correct counts", () => {
  const view = buildFolderView(fixture(), new Set());
  assert.equal(view.nodes.length, 3);
  const people = view.nodes.find(n => n.id === folderIdForType("person"));
  assert.ok(people);
  assert.equal((people.metadata as { count: number }).count, 3);
  assert.ok(view.nodes.every(n => isFolderNodeId(n.id)));
});

test("expanded type contributes real nodes; others stay folders", () => {
  const view = buildFolderView(fixture(), new Set(["person"]));
  const ids = view.nodes.map(n => n.id).sort();
  assert.deepEqual(ids, [
    folderIdForType("community"),
    folderIdForType("event"),
    "person:a",
    "person:b",
    "person:c",
  ]);
});

// ── buildFolderView: link lifting ────────────────────────────────────────────

test("links to hidden members remap to the folder and merge with weight", () => {
  const view = buildFolderView(fixture(), new Set(["person"]));
  // Two attended links now both run person → folder:event (ring edges between
  // folders are separate and excluded here).
  const lifted = view.links.filter(l =>
    (l.target === folderIdForType("event") || l.source === folderIdForType("event")) &&
    !(isFolderNodeId(String(l.source)) && isFolderNodeId(String(l.target))));
  assert.equal(lifted.length, 2); // person:a—folder:event, person:b—folder:event
  lifted.forEach(l => assert.equal((l as unknown as { weight: number }).weight, 1));
});

test("intra-folder and aggregate folder-to-folder links collapse to nothing", () => {
  const view = buildFolderView(fixture(), new Set());
  // person:a—person:b is inside the People folder → dropped.
  assert.equal(view.links.filter(l => l.source === l.target).length, 0);
  // The only folder-to-folder edges are the deliberate `types` ring — the two
  // attended links must NOT surface as a weighted People—Events aggregate.
  const folderToFolder = view.links.filter(l =>
    isFolderNodeId(String(l.source)) && isFolderNodeId(String(l.target)));
  folderToFolder.forEach(e => {
    assert.equal(e.relationship, "types");
    assert.equal((e as unknown as { weight: number }).weight, 1);
  });
});

test("dangling endpoints drop, matching the full view's behaviour", () => {
  const data = fixture();
  data.links.push({ source: "person:a", target: "ghost:1", relationship: "knows" });
  const view = buildFolderView(data, new Set());
  assert.ok(view.links.every(l => l.source !== "ghost:1" && l.target !== "ghost:1"));
});

// ── placeFolderView: transition placement ────────────────────────────────────

test("returns null when nothing is known yet (first paint)", () => {
  const view = buildFolderView(fixture(), new Set());
  assert.equal(placeFolderView(view, fixture().nodes, new Map()), null);
});

test("expansion keeps carried-over nodes and spirals members around the folder", () => {
  const known = new Map([
    [folderIdForType("person"), { x: 100, y: 50 }],
    [folderIdForType("event"), { x: -400, y: 0 }],
    [folderIdForType("community"), { x: 300, y: -200 }],
  ]);
  const view = buildFolderView(fixture(), new Set(["person"]));
  const placed = placeFolderView(view, fixture().nodes, known);
  assert.ok(placed);
  // Untouched folders stay put.
  assert.deepEqual(placed.get(folderIdForType("event")), { x: -400, y: 0 });
  // Every visible node has a position; members centre on the old folder spot.
  view.nodes.forEach(n => assert.ok(placed.has(String(n.id)), `missing ${n.id}`));
  const first = placed.get("person:a");
  assert.deepEqual(first, { x: 100, y: 50 }); // spiral index 0 sits at the anchor
});

test("collapse places the folder at its members' centroid", () => {
  const known = new Map([
    ["person:a", { x: 0, y: 0 }],
    ["person:b", { x: 200, y: 100 }],
    ["person:c", { x: 100, y: 200 }],
    [folderIdForType("event"), { x: -400, y: 0 }],
    [folderIdForType("community"), { x: 300, y: -200 }],
  ]);
  const view = buildFolderView(fixture(), new Set());
  const placed = placeFolderView(view, fixture().nodes, known);
  assert.ok(placed);
  assert.deepEqual(placed.get(folderIdForType("person")), { x: 100, y: 100 });
});

// ── ring of types ────────────────────────────────────────────────────────────

test("folders link to each other in a circle of types edges", () => {
  const view = buildFolderView(fixture(), new Set());
  // 3 folders → 3 ring edges closing the cycle, all labeled `types`.
  const ringEdges = view.links.filter(l =>
    isFolderNodeId(String(l.source)) && isFolderNodeId(String(l.target)));
  assert.equal(ringEdges.length, 3);
  ringEdges.forEach(e => assert.equal(e.relationship, "types"));
  // Every folder touches exactly two ring edges (a proper cycle).
  view.nodes.filter(n => isFolderNodeId(n.id)).forEach(folder => {
    const touching = ringEdges.filter(e => e.source === folder.id || e.target === folder.id);
    assert.equal(touching.length, 2, `${folder.id} is not on the cycle`);
  });
});

test("two folders produce a single connecting edge, not a doubled pair", () => {
  const data = fixture();
  data.nodes = data.nodes.filter(n => n.type !== "community");
  data.links = data.links.filter(l => l.target !== "community:h");
  const view = buildFolderView(data, new Set());
  const ringEdges = view.links.filter(l =>
    isFolderNodeId(String(l.source)) && isFolderNodeId(String(l.target)));
  assert.equal(ringEdges.length, 1);
});

test("typeRingLayout puts every folder on one shared circle", () => {
  const view = buildFolderView(fixture(), new Set());
  const ring = typeRingLayout(view);
  assert.ok(ring);
  const radii = view.nodes
    .filter(n => isFolderNodeId(n.id))
    .map(n => { const p = ring.get(n.id)!; return Math.hypot(p.x, p.y); });
  radii.forEach(r => assert.ok(Math.abs(r - radii[0]) < 1e-6, "folders share one radius"));
});

test("typeRingLayout declines when anything is expanded", () => {
  const view = buildFolderView(fixture(), new Set(["person"]));
  assert.equal(typeRingLayout(view), null);
});

// ── alias circles ────────────────────────────────────────────────────────────

const aliasFixture = (): ContextData => {
  const data = fixture();
  data.nodes[0].alias = "Founder";
  data.nodes[1].alias = "Founder";
  data.nodes[2].alias = "Investor";
  return data;
};

// Only configured aliases become circles (events reuse the alias column for
// URL slugs), so the fixtures carry an alias registry.
const ALIASES = [
  { name: "Founder", color: "#16a34a", nodeType: "person" },
  { name: "Investor", color: "#2563eb", nodeType: "person" },
];

test("collapsed folders branch one alias circle per alias, with counts", () => {
  const view = buildFolderView(aliasFixture(), new Set(), { communityAliases: ALIASES });
  const founder = view.nodes.find(n => n.id === aliasNodeId("person", "Founder"));
  const investor = view.nodes.find(n => n.id === aliasNodeId("person", "Investor"));
  assert.ok(founder && investor);
  assert.equal(folderCount(founder), 2);
  assert.equal(folderCount(investor), 1);
  assert.equal(founder.alias, "Founder"); // lets the canvas resolve alias colour
  // Each alias circle links to its parent folder with an `alias` edge.
  const edge = view.links.find(l =>
    [l.source, l.target].includes(founder.id) &&
    [l.source, l.target].includes(folderIdForType("person")));
  assert.ok(edge);
  assert.equal(edge!.relationship, "alias");
  assert.equal((edge as unknown as { weight: number }).weight, 2);
});

test("expanding one alias pulls only that role out of the folder", () => {
  const view = buildFolderView(
    aliasFixture(),
    new Set([aliasExpansionKey("person", "Founder")]),
    { communityAliases: ALIASES },
  );
  const ids = view.nodes.map(n => n.id);
  assert.ok(ids.includes("person:a") && ids.includes("person:b"), "Founders are out");
  assert.ok(!ids.includes("person:c"), "Investor stays folded");
  // The folder remains with the rest, its Founder circle gone, Investor kept.
  const folder = view.nodes.find(n => n.id === folderIdForType("person"))!;
  assert.equal(folderCount(folder), 1);
  assert.ok(!ids.includes(aliasNodeId("person", "Founder")));
  assert.ok(ids.includes(aliasNodeId("person", "Investor")));
  // Expanded members branch off the folder with their role as the label.
  const branch = view.links.find(l =>
    [l.source, l.target].includes("person:b") &&
    [l.source, l.target].includes(folderIdForType("person")));
  assert.ok(branch);
  assert.equal(branch!.relationship, "Founder");
});

test("alias circles disappear when their type is expanded", () => {
  const view = buildFolderView(aliasFixture(), new Set(["person"]), { communityAliases: ALIASES });
  assert.ok(view.nodes.every(n => !isAliasNodeId(n.id)));
});

test("unconfigured aliases (event URL slugs) never become circles", () => {
  const data = fixture();
  data.nodes.find(n => n.id === "event:x")!.alias = "demo-day-2026";
  const view = buildFolderView(data, new Set(), { communityAliases: ALIASES });
  assert.ok(view.nodes.every(n => !isAliasNodeId(n.id)));
});

test("type ring places alias circles orbiting their parent folder", () => {
  const view = buildFolderView(aliasFixture(), new Set(), { communityAliases: ALIASES });
  const ring = typeRingLayout(view);
  assert.ok(ring);
  const folderPos = ring.get(folderIdForType("person"))!;
  const founder = view.nodes.find(n => n.id === aliasNodeId("person", "Founder"))!;
  const aliasPos = ring.get(founder.id)!;
  const dist = Math.hypot(aliasPos.x - folderPos.x, aliasPos.y - folderPos.y);
  const expected = folderRadius(3) + aliasRadius(2) + 36;
  assert.ok(Math.abs(dist - expected) < 1e-6, `alias orbit distance ${dist} vs ${expected}`);
});

// ── neighbourhood reveal ─────────────────────────────────────────────────────

test("revealing a node pulls its direct neighbours out of their folders", () => {
  // person:a links to event:x (attended) and person:b (knows).
  const view = buildFolderView(fixture(), new Set(), { revealNeighborsOf: "person:a" });
  const ids = view.nodes.map(n => n.id);
  assert.ok(ids.includes("person:a") && ids.includes("person:b") && ids.includes("event:x"));
  assert.ok(!ids.includes("person:c"), "unconnected member stays folded");
  // People folder keeps just person:c; the only event is out, so no Events folder.
  assert.equal(folderCount(view.nodes.find(n => n.id === folderIdForType("person"))!), 1);
  assert.ok(!ids.includes(folderIdForType("event")));
  // The revealed neighbours draw their REAL edges to the selected node.
  const attended = view.links.find(l =>
    [l.source, l.target].includes("person:a") && [l.source, l.target].includes("event:x"));
  assert.equal(attended!.relationship, "attended");
});

test("clearing the reveal folds everything back", () => {
  const withReveal = buildFolderView(fixture(), new Set(), { revealNeighborsOf: "person:a" });
  const without = buildFolderView(fixture(), new Set(), { revealNeighborsOf: null });
  assert.ok(withReveal.nodes.length > without.nodes.length - 1);
  assert.ok(without.nodes.every(n => isFolderNodeId(n.id)));
});

// ── labels ───────────────────────────────────────────────────────────────────

test("pluralTypeLabel handles the irregulars", () => {
  assert.equal(pluralTypeLabel("person"), "People");
  assert.equal(pluralTypeLabel("community"), "Communities");
  assert.equal(pluralTypeLabel("event"), "Events");
});
