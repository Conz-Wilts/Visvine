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

