/**
 * Context data normalization and filtering utilities
 */

import type { NBNode, NBLink, NodeType } from '../types';
import { normalizeImageUrl } from '../mediaUrl';

/**
 * Normalize a node to ensure all required fields exist
 */
export function normalizeNode(node: NBNode): NBNode {
  return {
    ...node,
    id: String(node.id),
    type: (node.type as NodeType) ?? 'People',
    name: String(node.name ?? node.id),
    subtitle: node.subtitle ?? '',
    location: node.location ?? '',
    url: node.url ?? '',
    tags: Array.isArray(node.tags) ? node.tags : [],
    metadata: typeof node.metadata === 'object' && node.metadata !== null ? node.metadata : undefined,
    image_url: normalizeImageUrl(node.image_url) ?? undefined
  };
}

/**
 * Normalize a link to ensure consistent string IDs
 */
export function normalizeLink(link: NBLink): NBLink {
  return {
    ...link,
    source: typeof link.source === 'object' ? String(link.source.id) : String(link.source),
    target: typeof link.target === 'object' ? String(link.target.id) : String(link.target),
    relationship: String(link.relationship ?? 'unknown'),
    since: link.since ?? '',
    metadata: link.metadata ?? {}
  };
}

/**
 * Find best matching node ID based on query
 * Prioritizes name matches over subtitle, location, and tags
 */
export function findBestMatchingNodeId(nodes: NBNode[], query: string): string | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  let bestNodeId: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  const scoreCandidate = (candidate: string | undefined | null, query: string, weight: number) => {
    if (!candidate) return { score: Number.NEGATIVE_INFINITY, distance: Number.POSITIVE_INFINITY };

    const normalized = candidate.trim().toLowerCase();
    if (!normalized) return { score: Number.NEGATIVE_INFINITY, distance: Number.POSITIVE_INFINITY };

    // Exact match
    if (normalized === query) return { score: 1000 * weight, distance: 0 };

    // Substring match (earlier position = better)
    const substringIndex = normalized.indexOf(query);
    if (substringIndex !== -1) {
      return { score: (500 - substringIndex * 10) * weight, distance: 0 };
    }

    // Fuzzy match - simple character difference for distance
    const distance = Math.abs(normalized.length - query.length) + 
      Array.from(query).filter((char, i) => normalized[i] !== char).length;

    return { score: -distance * weight, distance };
  };

  for (const node of nodes) {
    // Define candidates with priority weights
    // Higher weight = higher priority in search results
    const weightedCandidates: Array<{ value: string | undefined | null; weight: number }> = [
      { value: node.name, weight: 100 },        // Name gets highest priority
      { value: node.subtitle, weight: 10 },     // Subtitle gets medium-high priority
      { value: String(node.id), weight: 5 },    // ID gets medium priority
      { value: node.location, weight: 2 },      // Location gets low priority
      ...((node.tags ?? []).map(tag => ({ value: tag, weight: 1 }))) // Tags get lowest priority
    ];

    for (const { value, weight } of weightedCandidates) {
      const { score, distance } = scoreCandidate(value, normalizedQuery, weight);
      
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
        bestScore = score;
        bestDistance = distance;
        bestNodeId = node.id;
      }
    }
  }

  if (bestNodeId == null) return null;

  // Require reasonable match quality
  if (bestScore < 0 && bestDistance > Math.max(2, Math.ceil(normalizedQuery.length * 0.6))) {
    return null;
  }

  return bestNodeId;
}

