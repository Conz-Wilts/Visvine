/**
 * Shared avatar utility functions used across messaging, directory, and space components.
 */

/**
 * Default tint for silhouettes with no type/accent context. Routed through the
 * theme variable so the user's chosen accent colour applies (ThemeContext
 * overrides --color-brand-green at runtime); the hex is only the pre-hydration
 * fallback. DOM-only — canvas fillStyle can't resolve var().
 */
export const THEME_ACCENT = 'var(--color-brand-green, #78d870)';

/**
 * SVG path for the person-silhouette avatar fallback (24×24 viewBox).
 * Single source of truth so the React fallback (PersonSilhouette) and the
 * canvas context renderers draw the identical glyph.
 */
export const PERSON_SILHOUETTE_PATH =
  'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v2h16v-2c0-3.31-3.58-6-8-6Z';

/**
 * SVG path for the group/organisation avatar fallback (24×24 viewBox): a house —
 * reads as "space/place" rather than a cluster of people. The canvas glyph
 * drawer and <TypeSilhouette> both draw this so the glyph is identical on the
 * context and in the DOM. Filled (non-zero winding), so it fills white the same
 * way the person glyph does.
 */
const GROUP_SILHOUETTE_PATH =
  'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z';

/**
 * SVG path for the event avatar fallback (24×24 viewBox): a calendar with a
 * marked date. Drawn identically by <TypeSilhouette> and the canvas renderers.
 */
const EVENT_SILHOUETTE_PATH =
  'M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z';

/**
 * SVG path for the resource avatar fallback (24×24 viewBox): a document with
 * text lines. Drawn identically by <TypeSilhouette> and the canvas renderers.
 */
const RESOURCE_SILHOUETTE_PATH =
  'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z';

/**
 * SVG path for the connector avatar fallback (24×24 viewBox): an electrical
 * plug — a connector is a gateway to something outside the space, and the
 * plug is the same metaphor the console's Connectors section uses.
 */
const CONNECTOR_SILHOUETTE_PATH =
  'M16.01 7 16 3h-2v4h-4V3H8v4h-.01C7 6.99 6 7.99 6 8.99v5.49L9.5 18v3h5v-3l3.5-3.51v-5.5c0-1-1-2-1.99-1.99z';

/** Node-type glyph → its 24×24 silhouette path (the getNodeGlyph value space). */
export const NODE_GLYPH_PATHS = {
  person: PERSON_SILHOUETTE_PATH,
  group: GROUP_SILHOUETTE_PATH,
  event: EVENT_SILHOUETTE_PATH,
  resource: RESOURCE_SILHOUETTE_PATH,
  connector: CONNECTOR_SILHOUETTE_PATH,
} as const;

export type NodeGlyph = keyof typeof NODE_GLYPH_PATHS;

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
