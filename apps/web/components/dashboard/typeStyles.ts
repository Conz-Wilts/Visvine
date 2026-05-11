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
 * Header background style for node cards.
 * Pass the already-resolved colour (alias-aware) so the header can't drift
 * from a border/badge using the same colour elsewhere on the card.
 */
export const getHeaderBgStyle = (color: string): CSSProperties => ({
  background: `linear-gradient(135deg, ${color}cc 0%, ${color} 100%)`,
});
