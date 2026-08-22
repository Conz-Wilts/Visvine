import test from "node:test";
import assert from "node:assert/strict";
import {
  pairKeyFor,
  normalizeRelationship,
  getLinkTypeConfig,
  isSystemRelationship,
} from "../lib/notes/context/relationships";
import {
  STRUCTURAL_NODE_TYPES,
  getNodeTypeConfig,
  isStructuralNodeType,
} from "../lib/types/context";
import type { LinkTypeConfig } from "../lib/types";

// ── pairKeyFor: the dedup key that makes reversed pairs collapse to one edge ──

test("pairKeyFor is order-independent (A->B and B->A share a key)", () => {
  assert.equal(pairKeyFor("a", "b"), pairKeyFor("b", "a"));
  assert.equal(pairKeyFor("person:9", "event:1"), pairKeyFor("event:1", "person:9"));
});

test("pairKeyFor sorts lexicographically into minId|maxId", () => {
  assert.equal(pairKeyFor("b", "a"), "a|b");
  assert.equal(pairKeyFor("a", "b"), "a|b");
});

test("pairKeyFor distinguishes different pairs", () => {
  assert.notEqual(pairKeyFor("a", "b"), pairKeyFor("a", "c"));
});

// ── normalizeRelationship: label -> stored slug ──

test("normalizeRelationship slugs human labels", () => {
  assert.equal(normalizeRelationship("Works at"), "works_at");
  assert.equal(normalizeRelationship("Invested in"), "invested_in");
  assert.equal(normalizeRelationship("Introduced"), "introduced");
  assert.equal(normalizeRelationship("Member of"), "member_of");
});

test("normalizeRelationship is idempotent on existing slugs", () => {
  assert.equal(normalizeRelationship("works_at"), "works_at");
  assert.equal(normalizeRelationship("co_invests_with"), "co_invests_with");
});

test("normalizeRelationship trims, lowercases, collapses, strips edges", () => {
  assert.equal(normalizeRelationship("  Partner—With  "), "partner_with");
  assert.equal(normalizeRelationship("A & B"), "a_b");
  assert.equal(normalizeRelationship("__weird__"), "weird");
  assert.equal(normalizeRelationship(""), "");
});

// ── getLinkTypeConfig: resolve a stored relationship to a display config ──

const SPACE_TYPES: LinkTypeConfig[] = [
  { name: "Backs", color: "#111111", directed: true },
  { name: "Related", color: "#222222", directed: false },
];

test("getLinkTypeConfig prefers the space config (by slugified name)", () => {
  const cfg = getLinkTypeConfig("backs", SPACE_TYPES);
  assert.equal(cfg.color, "#111111");
  assert.equal(cfg.directed, true);
});

test("getLinkTypeConfig falls back to the default set when no space config", () => {
  const cfg = getLinkTypeConfig("works_at");
  assert.equal(cfg.name, "Works at");
  assert.equal(cfg.directed, true);
});

test("getLinkTypeConfig returns a neutral, title-cased config for unknown relationships", () => {
  const cfg = getLinkTypeConfig("co_invests_with", SPACE_TYPES);
  assert.equal(cfg.name, "Co Invests With");
  assert.equal(cfg.color, "#94a3b8");
  assert.equal(cfg.directed, false);
});

// ── isSystemRelationship: protects the auto-flow types ──

test("isSystemRelationship is true for the auto-flow relationships", () => {
  assert.equal(isSystemRelationship("attended"), true);
  assert.equal(isSystemRelationship("hosting"), true);
  assert.equal(isSystemRelationship("introduced"), true);
});

test("isSystemRelationship is false for ordinary manual relationships", () => {
  assert.equal(isSystemRelationship("related"), false);
  assert.equal(isSystemRelationship("knows"), false);
  assert.equal(isSystemRelationship("works_at"), false);
});

// ── Structural node types: everything creatable is a node, but the graph and the
//    directory only show the structure kinds when asked ─────────────────────────

test("isStructuralNodeType covers the container kinds", () => {
  for (const type of ["section", "channel", "connector"]) {
    assert.equal(isStructuralNodeType(type), true, type);
  }
  assert.equal(isStructuralNodeType("Channel"), true);
  // Note and File are retired types. Nothing writes them, but a row left over
  // from before stays filtered out rather than surfacing in the grid.
  assert.equal(isStructuralNodeType("note"), true);
  assert.equal(isStructuralNodeType("file"), true);
});

// `space` (the org type) belongs here, not above: it
// carries the organisations that used to be the Group type, which are
// directory records people expect to see.
test("isStructuralNodeType leaves the directory kinds alone", () => {
  for (const type of ["person", "space", "space", "group", "organization", "event", "resource"]) {
    assert.equal(isStructuralNodeType(type), false, type);
  }
  assert.equal(isStructuralNodeType(null), false);
  assert.equal(isStructuralNodeType(""), false);
});

// Retired types are exempt: they're listed only so leftover rows stay filtered
// out, and DEFAULT_NODE_TYPES does not describe them. `index` is among them
// because a folder is a path, never a type (lib/notes/shared/indexNote.ts).
const RETIRED_TYPES = ["note", "file", "index"];

test("every live structural type resolves to a non-grey colour", () => {
  for (const type of STRUCTURAL_NODE_TYPES) {
    if (RETIRED_TYPES.includes(type)) continue;
    assert.notEqual(getNodeTypeConfig(type).color, "#6b7280", type);
  }
});

test("'Contains' is a system link type, so it can be recoloured but not deleted", () => {
  assert.equal(isSystemRelationship("contains"), true);
  assert.equal(normalizeRelationship("Contains"), "contains");
});
