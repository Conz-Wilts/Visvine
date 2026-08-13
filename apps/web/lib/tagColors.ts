// Tag colours. A space keeps a tag → base-colour registry in its
// designConfig (see SpaceDesignConfig.tagColors); a tag chosen without a
// registered colour falls back to a deterministic palette pick, so every tag
// renders coloured. The picker offers PALETTES as swatches.

import { PALETTES, hexToPalette, type ThemePalette } from '@/lib/profileTheme';

/** Selectable base colours for the tag picker (the profile-theme palette). */
export const TAG_SWATCHES: string[] = PALETTES.map((p) => p.base);

/** Canonical registry key for a tag — trimmed + lower-cased. */
export function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Accepts #rgb / #rrggbb. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

// Stable string hash → palette index, so an unregistered tag always maps to the
// same swatch (deterministic across sessions and users).
function hashIndex(s: string, n: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
}

/** Base hex for a tag: registered colour if present, else a deterministic pick. */
export function resolveTagBase(tag: string, registry?: Record<string, string> | null): string {
  const key = tagKey(tag);
  const registered = registry?.[key];
  if (isHexColor(registered)) return registered;
  return PALETTES[hashIndex(key, PALETTES.length)].base;
}

/** Full {base,light,dark} palette for a tag chip. */
export function tagPalette(tag: string, registry?: Record<string, string> | null): ThemePalette {
  return hexToPalette(resolveTagBase(tag, registry));
}
