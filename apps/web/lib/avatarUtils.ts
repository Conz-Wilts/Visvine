/**
 * Shared avatar utility functions used across messaging, directory, and community components.
 */

/** Brand green — default tint for person silhouettes with no type/accent context. */
export const BRAND_GREEN = '#78d870';

/**
 * SVG path for the person-silhouette avatar fallback (24×24 viewBox).
 * Single source of truth so the React fallback (PersonSilhouette) and the
 * canvas graph renderers draw the identical glyph.
 */
export const PERSON_SILHOUETTE_PATH =
  'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6Z';

/**
 * SVG path for the group/organisation avatar fallback (24×24 viewBox): a cluster
 * of person silhouettes. The canvas group drawer and the <GroupSilhouette>
 * component both draw this so the glyph is identical on the graph and in the DOM.
 * Filled (non-zero winding), so it fills white the same way the person glyph does.
 */
export const GROUP_SILHOUETTE_PATH =
  'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z';

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
