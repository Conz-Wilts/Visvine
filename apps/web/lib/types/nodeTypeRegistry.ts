// Adding a type to a community's vocabulary, in one place.
//
// A community's `nodeTypes` used to be write-only-by-admin and closed: the
// console could recolour the built-ins and nothing could create a type. Members
// can now invent one from the draft-context surface, which means the "is this
// name already served, and what should it look like" rule is asked from three
// places — the member endpoint, the console, and the backfill script. This is
// that rule, kept pure so it can be unit-tested and can't drift between them.

import { PALETTES } from '@/lib/profileTheme';
import {
  DEFAULT_NODE_TYPES,
  findNodeTypeConfig,
  type NodeTypeConfig,
} from './context';

/** Longest a type name may be — it has to fit a chip. */
const MAX_NAME = 32;

/**
 * Names that must never become a type, whatever the synonym table says.
 *
 * `Index` is the dangerous one: the notes API relocates a `type: Index` note
 * into a folder of its own (app/api/notes/item/route.ts), so a community that
 * created an "Index" type would silently move its members' notes. `Note` and
 * `File` are the two things that are content in a brain rather than nodes in
 * the graph — the draft menu offers them already and they are not node types.
 */
const RESERVED = ['note', 'file', 'index'];

/**
 * Is this name one no community may create a type for? Surfaces that OFFER
 * stored types ask this too: a brain seeded with a `Note` or `Index` type (see
 * prisma/seed.ts) still has one, and it must not reach a picker that would
 * write it into a note's frontmatter.
 */
export function isReservedTypeName(name: string | null | undefined): boolean {
  return RESERVED.includes((name ?? '').trim().toLowerCase());
}

/** Letters, digits, spaces, hyphens and ampersands. No slashes (note paths), no colons (node ids). */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} \-&]*$/u;

/** Strict 6-digit hex. Three-digit hex breaks hexToRgb, which slices 6 chars. */
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * The stored spelling of a type a member typed: whitespace collapsed and the
 * first letter capitalised, so "playbook" and " Playbook " are one type named
 * `Playbook`. Casing matters downstream — retrieval filters note frontmatter
 * types with an exact, case-sensitive compare — so this is the ONE spelling
 * everything writes.
 */
export function normalizeTypeName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return collapsed.charAt(0).toUpperCase() + collapsed.slice(1);
}

/**
 * A deterministic colour for a type nobody picked one for, drawn from the same
 * palette the swatch strip offers — so the default is always a colour the user
 * could have chosen, and a given name always lands on the same one.
 */
export function defaultNodeTypeColor(name: string): string {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTES[hash % PALETTES.length].base;
}

/**
 * A community's type list as the app should see it. The column is nullable and
 * a community seeded before a built-in existed can be missing it, so anything
 * that MERGES has to start from the defaults — otherwise the first write turns
 * a full vocabulary into a one-entry array.
 */
export function seedNodeTypes(stored: NodeTypeConfig[] | null | undefined): NodeTypeConfig[] {
  return stored && stored.length > 0 ? stored : DEFAULT_NODE_TYPES;
}

/**
 * Fold an edited type list back onto what is stored, additively.
 *
 * The console saves the WHOLE community record from a client snapshot that can
 * be minutes old (features/admin/components/TypesPanel.tsx), so a plain
 * overwrite means an admin recolouring Person deletes every type a member
 * created in the meantime. Incoming entries win on colour/shape/icon — that is
 * the edit being saved — and anything stored but absent from the payload is
 * kept. Removing a type is therefore not something a stale snapshot can do by
 * accident; it needs its own deliberate call.
 */
export function mergeNodeTypeList(
  stored: NodeTypeConfig[] | null | undefined,
  incoming: NodeTypeConfig[] | null | undefined,
): NodeTypeConfig[] {
  const key = (t: NodeTypeConfig) => t.name?.trim().toLowerCase();
  const edits = new Map((incoming ?? []).map((t) => [key(t), t]));
  // Stored order is kept — a recolour must not shuffle the vocabulary.
  const next = (stored ?? []).map((t) => edits.get(key(t)) ?? t);
  const kept = new Set((stored ?? []).map(key));
  for (const type of incoming ?? []) {
    if (!kept.has(key(type))) next.push(type);
  }
  return next;
}

export type MergeNodeTypeResult =
  | { ok: true; types: NodeTypeConfig[]; type: NodeTypeConfig; created: boolean }
  | { ok: false; error: string };

/**
 * Add a type to a community's vocabulary, or resolve the one already serving
 * that name.
 *
 * First writer wins: if the name (or a synonym of it — `Company` is served by
 * `Space`) already resolves, the stored entry comes back untouched with
 * `created: false`. A later member choosing a different colour must not quietly
 * repaint everyone else's chips.
 *
 * Types created this way are `scope: 'note'`: they exist to label context
 * notes, and nothing syncs a graph node for a note. Surfaces that list types
 * for FILTERING nodes skip them (features/directory/hooks/useDirectoryBrowse)
 * so a member's type never becomes a directory filter that matches nothing.
 */
export function mergeNodeType(
  stored: NodeTypeConfig[] | null | undefined,
  input: { name: string; color?: string | null },
): MergeNodeTypeResult {
  const name = normalizeTypeName(input.name ?? '');
  if (!name) return { ok: false, error: 'A type needs a name' };
  if (name.length > MAX_NAME) return { ok: false, error: `A type name is at most ${MAX_NAME} characters` };
  if (!NAME_PATTERN.test(name)) return { ok: false, error: 'A type name can only use letters, numbers, spaces and hyphens' };
  if (isReservedTypeName(name)) return { ok: false, error: `"${name}" is reserved` };

  const color = input.color ?? defaultNodeTypeColor(name);
  if (!HEX_PATTERN.test(color)) return { ok: false, error: 'A colour must be a 6-digit hex like #3b82f6' };

  const types = seedNodeTypes(stored);
  // findNodeTypeConfig resolves synonyms as well as exact names, so this single
  // check covers the built-ins, the community's own types, and every retired
  // spelling that folds onto one of them.
  const existing = findNodeTypeConfig(name, types);
  if (existing) return { ok: true, types, type: existing, created: false };

  const type: NodeTypeConfig = { name, color, shape: 'rectangle', scope: 'note' };
  return { ok: true, types: [...types, type], type, created: true };
}
