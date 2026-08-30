// Adding a type to a space's vocabulary — and taking a member-made one back
// out — in one place.
//
// Members can invent a type from the draft-context surface, so the "is this
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
 * `Index` names a SHAPE, not a subject: a folder is a path (its `index.md`),
 * and a note's type says what it is ABOUT — so a folder about Connor is
 * `type: Person`. A space that created an "Index" type would put the two axes
 * back into one field, which is the confusion the model exists to remove; the
 * index contract strips the word on write (lib/notes/shared/indexNote.ts).
 * `Note` and `File` are the two things that are content in a context rather
 * than nodes in the graph — the draft menu offers them already and they are not
 * node types.
 *
 * `Tool` (and its plural, which TYPE_SYNONYMS folds onto it) is reserved because
 * `type: tool` is machine config: it marks the index of an entity folder under
 * tools/ whose sub-notes are executable source (lib/tools). A member typing
 * "Tool" into the draft type picker must not be able to stamp that type onto an
 * ordinary note — unlike Connector and Agent, whose types nothing outside their
 * own namespace acts on.
 */
const RESERVED = ['note', 'file', 'index', 'tool', 'tools'];

/**
 * Is this name one no space may create a type for? Surfaces that OFFER
 * stored types ask this too: a space whose stored vocabulary still carries a
 * `Note` or `Index` row must not offer it to a picker that would write it into
 * a note's frontmatter.
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
 * A space's type list as the app should see it. The column is nullable and
 * a space seeded before a built-in existed can be missing it, so anything
 * that MERGES has to start from the defaults — otherwise the first write turns
 * a full vocabulary into a one-entry array.
 */
export function seedNodeTypes(stored: NodeTypeConfig[] | null | undefined): NodeTypeConfig[] {
  return stored && stored.length > 0 ? stored : DEFAULT_NODE_TYPES;
}

/**
 * Fold an edited type list back onto what is stored, additively.
 *
 * The console saves the WHOLE space record from a client snapshot that can
 * be minutes old (features/admin/components/TypesPanel.tsx), so a plain
 * overwrite means an admin recolouring Person deletes every type a member
 * created in the meantime. Incoming entries win on colour/shape — that is
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
 * Add a type to a space's vocabulary, or resolve the one already serving
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
  // check covers the built-ins, the space's own types, and every retired
  // spelling that folds onto one of them.
  const existing = findNodeTypeConfig(name, types);
  if (existing) return { ok: true, types, type: existing, created: false };

  const type: NodeTypeConfig = { name, color, shape: 'rectangle', scope: 'note' };
  return { ok: true, types: [...types, type], type, created: true };
}

export type RemoveNodeTypeResult =
  | { ok: true; types: NodeTypeConfig[]; type: NodeTypeConfig }
  | { ok: false; error: string };

/**
 * Take a member-made type back out of a space's vocabulary.
 *
 * Only a `scope: 'note'` type can go: the built-ins are what the tools create
 * entities under, so a space that deleted `Person` would have a directory it
 * could no longer add to. A custom type is vocabulary and nothing else — it
 * colours and labels notes that already declare it — so removing it leaves
 * those notes' `type:` alone, exactly the way removing a tracked field leaves
 * its values in place. They fall back to the unstyled default until somebody
 * names the type again.
 *
 * Deliberate by construction: the whole-record PUT merges additively
 * (mergeNodeTypeList), so this is the one call that can shorten the list.
 */
export function removeNodeType(
  stored: NodeTypeConfig[] | null | undefined,
  name: string,
): RemoveNodeTypeResult {
  const wanted = (name ?? '').trim().toLowerCase();
  if (!wanted) return { ok: false, error: 'A type needs a name' };

  const types = seedNodeTypes(stored);
  const type = types.find((t) => t.name.trim().toLowerCase() === wanted);
  if (!type) return { ok: false, error: `No type named "${name}"` };
  // Asked of the entry as stored AND of the registry, so a space that somehow
  // stored `Person` with `scope: 'note'` still can't delete a built-in.
  const builtIn = DEFAULT_NODE_TYPES.some((t) => t.name.toLowerCase() === wanted);
  if (type.scope !== 'note' || builtIn) {
    return { ok: false, error: `"${type.name}" is a built-in type and can't be deleted` };
  }

  return { ok: true, types: types.filter((t) => t !== type), type };
}
