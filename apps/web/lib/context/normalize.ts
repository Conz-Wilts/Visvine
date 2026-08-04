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
  let bestScore = 0;

  const scoreCandidate = (candidate: string | undefined | null, query: string, weight: number): number => {
    if (!candidate) return 0;

    const normalized = candidate.trim().toLowerCase();
    if (!normalized) return 0;

    // Exact match
    if (normalized === query) return 1000 * weight;

    // Substring match (earlier position = better); a match at the start of the
    // string or of a word beats one buried mid-word.
    const substringIndex = normalized.indexOf(query);
    if (substringIndex !== -1) {
      const atWordStart = substringIndex === 0 || normalized[substringIndex - 1] === ' ';
      return (500 + (atWordStart ? 100 : 0) - substringIndex * 5) * weight;
    }

    // Fuzzy match: edit-distance similarity against the whole string and each
    // word, taking the best. A typo like "fernwar" → "fernwave" stays close;
    // unrelated strings fall under the threshold and score 0.
    const targets = [normalized, ...(normalized.includes(' ') ? normalized.split(' ') : [])];
    let bestSimilarity = 0;
    for (const target of targets) {
      // Compare against the target's prefix of query length too, so a typo'd
      // prefix of a long name isn't penalised for the unmatched tail.
      const prefix = target.slice(0, query.length);
      for (const t of [target, prefix]) {
        const maxLen = Math.max(t.length, query.length);
        if (maxLen === 0) continue;
        const similarity = 1 - levenshtein(query, t) / maxLen;
        if (similarity > bestSimilarity) bestSimilarity = similarity;
      }
    }
    if (bestSimilarity < 0.6) return 0;
    return bestSimilarity * 100 * weight;
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
      const score = scoreCandidate(value, normalizedQuery, weight);
      if (score > bestScore) {
        bestScore = score;
        bestNodeId = node.id;
      }
    }
  }

  return bestNodeId;
}

/** Standard Levenshtein edit distance (two-row implementation). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

