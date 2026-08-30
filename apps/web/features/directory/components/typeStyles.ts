import type { CSSProperties } from 'react'
import { NodeType, getNodeTypeConfig, NodeTypeConfig } from '@/lib/types'

/**
 * Get the canonical colour for a node type, using space overrides if provided.
 * Always falls back to DEFAULT_NODE_TYPES so nodes are never grey.
 */
export const getTypeColor = (
  type: NodeType | string,
  spaceNodeTypes?: NodeTypeConfig[]
): string => getNodeTypeConfig(type, spaceNodeTypes).color;

/**
 * Header background style for node cards.
 * Pass the already-resolved colour (alias-aware) so the header can't drift
 * from a border/badge using the same colour elsewhere on the card.
 */
export const getHeaderBgStyle = (color: string): CSSProperties => ({
  background: color,
});

// There is deliberately no on-colour text helper here. Type bands paint the
// configured colour and always carry white labels: darkening a band until white
// cleared WCAG shifted its hue (the Index amber read as brown), and a band whose
// whole job is to say "this is the Index colour" has to be that colour.
