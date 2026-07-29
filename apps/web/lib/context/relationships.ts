/**
 * Relationship (edge) type registry helpers.
 *
 * The stored `Link.relationship` is a slug (e.g. "works_at"); the human label +
 * colour come from the community's configurable `linkTypes` (managed in the
 * console, mirroring node types), falling back to DEFAULT_LINK_TYPES. See
 * docs/link-management-design.md.
 */
import { DEFAULT_LINK_TYPES, getLinkTypes, type LinkTypeConfig } from '../types';

/** Normalized "minId|maxId" so A->B and B->A dedup as one undirected edge. The
 *  single source of truth for the dedup key, shared by the write path and the
 *  context renderer's parallel-edge curves. */
export function pairKeyFor(sourceId: string, targetId: string): string {
  return [sourceId, targetId].sort().join('|');
}

/**
 * Canonical slug for a relationship label. "Works at" -> "works_at",
 * "Introduced" -> "introduced". Stable for round-tripping label <-> stored value.
 */
export function normalizeRelationship(label: string): string {
  return (label ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Resolve the LinkTypeConfig for a stored relationship slug by matching the
 * slugified type name against the community's configured types (then the
 * defaults). Unknown relationships (e.g. legacy import vocabulary not in any
 * config) resolve to a neutral grey with a title-cased label, so the renderer
 * never hard-fails — the same forgiving strategy as getNodeTypeConfig.
 */
export function getLinkTypeConfig(
  relationship: string,
  communityLinkTypes?: LinkTypeConfig[],
): LinkTypeConfig {
  const slug = normalizeRelationship(relationship);
  const all = getLinkTypes(communityLinkTypes);
  const match = all.find((t) => normalizeRelationship(t.name) === slug);
  if (match) return match;
  const name = slug
    ? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Related';
  return { name, color: '#94a3b8', directed: false };
}

/** True when the relationship's configured type is the kind the auto-flows own. */
export function isSystemRelationship(relationship: string, communityLinkTypes?: LinkTypeConfig[]): boolean {
  return getLinkTypeConfig(relationship, communityLinkTypes).system === true
    || DEFAULT_LINK_TYPES.some((t) => t.system && normalizeRelationship(t.name) === normalizeRelationship(relationship));
}
