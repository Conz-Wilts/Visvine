import type { CSSProperties } from 'react'
import { NodeType, getNodeTypeConfig, NodeTypeConfig } from '@/lib/types'

/**
 * Get the canonical colour for a node type, using community overrides if provided.
 * Always falls back to DEFAULT_NODE_TYPES so nodes are never grey.
 */
export const getTypeColor = (
  type: NodeType | string,
  communityNodeTypes?: NodeTypeConfig[]
): string => getNodeTypeConfig(type, communityNodeTypes).color;

/**
 * Header background style for node cards — uses the type colour directly.
 * Returns a style object so callers can spread it onto a div.
 */
export const getHeaderBgStyle = (
  type: NodeType | string,
  communityNodeTypes?: NodeTypeConfig[]
): CSSProperties => {
  const color = getTypeColor(type, communityNodeTypes);
  return { background: `linear-gradient(135deg, ${color}cc 0%, ${color} 100%)` };
};
