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

/**
 * A type colour, darkened until white text sits legibly on top of it.
 *
 * Type colours are community-configurable, so a surface that puts white text on
 * one cannot assume anything about its lightness: Person blue carries white
 * fine, the default Community green (#78d870) does not, and an admin can pick
 * anything at all in the console. Rather than flipping the label to dark on
 * light types — which makes a row of bands look like two different components —
 * the band itself steps down in steps of 12% until white clears the WCAG AA
 * 4.5:1 threshold. The hue is untouched, so the type still reads as its colour.
 */
export const getOnWhiteTextBg = (color: string): string => {
  const hex = color.trim().replace('#', '');
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;

  let rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  // Relative luminance (WCAG 2.1); white-on-colour contrast is 1.05 / (L + 0.05).
  const luminance = (c: number[]) =>
    c
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);

  // Capped, so a pathological colour darkens toward black instead of looping.
  for (let step = 0; step < 12 && 1.05 / (luminance(rgb) + 0.05) < 4.5; step++) {
    rgb = rgb.map((v) => Math.round(v * 0.88));
  }
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
