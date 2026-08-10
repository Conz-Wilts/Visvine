// Pure visibility logic — no prisma, so routes and node:test suites can both
// import it (same split as lib/featureAccess.ts vs features/shared/lib/features.tsx).
// `getFeatureConfig` lives in lib/auth.ts, next to the other community reads.
//
// A tool you switched off takes its node types with it — everywhere, not just
// where you pick a type from a list.
//
// Switching off Connectors already removed Connector from the console's Types
// tab and from the create list, but the connector NODES stayed in the context
// graph, and switched-off Resources left its resources sitting in the directory
// grid with "resource" still in the Type dropdown. Half-hidden is worse than
// either state: the type is gone from every list that would explain it, and the
// things themselves are still there.
//
// Nothing is deleted. The rows are untouched and reappear in full the moment the
// tool is switched back on — this filters what a community SHOWS, not what it
// stores. (Notes are core and always on, so a hidden node's context note is
// still readable: its history outlives the tool that made it.)

import { isNodeTypeEnabled } from '@/lib/featureAccess'
import type { CommunityFeatureConfig, NBLink, NBNode } from '@/lib/types'

/** Keep only the nodes whose type belongs to a tool this community still has on. */
export function visibleNodes<T extends { type: string }>(
  nodes: T[],
  config: CommunityFeatureConfig | null,
): T[] {
  return nodes.filter((node) => isNodeTypeEnabled(config, node.type))
}

/**
 * The nodes a community still shows, plus only the links whose BOTH ends
 * survived. A link to a hidden node would render as an edge into nothing — the
 * canvas resolves endpoints by id, so a dangling one either throws the edge away
 * or draws it to the origin.
 */
export function visibleGraph(
  nodes: NBNode[],
  links: NBLink[],
  config: CommunityFeatureConfig | null,
): { nodes: NBNode[]; links: NBLink[] } {
  const kept = visibleNodes(nodes, config)
  const ids = new Set(kept.map((n) => n.id))
  return {
    nodes: kept,
    links: links.filter((l) => ids.has(String(l.source)) && ids.has(String(l.target))),
  }
}
