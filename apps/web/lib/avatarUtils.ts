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
 * SVG path for a space (24×24 viewBox): a square with a hollow ring on each
 * corner. The bars run into the rings (ending inside the ring's band, short of
 * its hole) so they join without a notch; that overlap is why the path fills
 * by winding — rings and bars clockwise, holes counter-clockwise — since the
 * even-odd rule would punch the overlap out. Every surface
 * that stands for a space draws this, whether as a silhouette or as the
 * `space` icon (see `getNodeGlyph`, `Avatar`'s `space` fallback).
 */
const SPACE_SILHOUETTE_PATH =
  [
    [5, 5],
    [19, 5],
    [5, 19],
    [19, 19],
  ]
    .map(([x, y]) => `M${x - 3.5} ${y}a3.5 3.5 0 1 1 7 0a3.5 3.5 0 1 1-7 0Z` + `M${x - 1.5} ${y}a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0Z`)
    .join('') +
  'M7 4h10v2H7ZM7 18h10v2H7ZM6 7v10H4V7ZM20 7v10h-2V7Z';

/**
 * The container glyph a section or a channel draws: the isometric cube spaces
 * used to wear. Three faces split by thin gaps so it reads as solid at avatar
 * size, filled by the non-zero winding rule like the person glyph.
 */
const GROUP_SILHOUETTE_PATH =
  'M12 2.2 20.4 6.9 12 11.6 3.6 6.9Z M2.8 8.6 11.1 13.2V22L2.8 17.3Z M21.2 8.6 12.9 13.2V22L21.2 17.3Z';

/**
 * SVG path for the event avatar fallback (24×24 viewBox): a calendar page with a
 * solid header band and a grid of days. The body and days nest, so it is drawn
 * with the even-odd rule (NODE_GLYPH_FILL_RULE).
 */
const EVENT_SILHOUETTE_PATH =
  'M7 2.8a1 1 0 0 1 2 0V4h6V2.8a1 1 0 0 1 2 0V4h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2Z M5 9h14v10H5Z' +
  'M6.8 11h2.2v2.2H6.8Z M10.9 11h2.2v2.2h-2.2Z M15 11h2.2v2.2H15Z M6.8 14.8h2.2V17H6.8Z M10.9 14.8h2.2V17h-2.2Z';

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

/**
 * SVG path for the agent avatar fallback (24×24 viewBox): a small robot head —
 * an agent is the one node type that acts on its own, and a brief reading as a
 * plain document was the thing that hid that in the Context tree.
 */
const AGENT_SILHOUETTE_PATH =
  'M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z';

/** Tool avatar: a wrench, matching the build/manage surface rather than a file. */
const TOOL_SILHOUETTE_PATH =
  'M22.7 19.3 13.4 10a6 6 0 0 0-7.7-7.7l3.1 3.1-2.8 2.8-3.1-3.1a6 6 0 0 0 7.7 7.7l9.3 9.3a2 2 0 0 0 2.8-2.8z';

/**
 * Model avatar: the AI sparkle — a large four-point star with a small one — used
 * when its provider logo is absent. Solid, no cut-outs.
 */
const MODEL_SILHOUETTE_PATH =
  'M10 4.5C10.7 10.3 11.7 11.8 18.5 13 11.7 14.2 10.7 15.7 10 21.5 9.3 15.7 8.3 14.2 1.5 13 8.3 11.8 9.3 10.3 10 4.5Z' +
  'M18.3 2C18.7 4.6 19.2 5.2 22 5.7 19.2 6.2 18.7 6.8 18.3 9.4 17.9 6.8 17.4 6.2 14.6 5.7 17.4 5.2 17.9 4.6 18.3 2Z';

/** Custom-type avatar: a neutral tag mark so cards never degrade to initials. */
const CUSTOM_SILHOUETTE_PATH =
  'M20 12 12 20 3 11V3h8l9 9zm-13-7v5.2l5 5 5.2-5L10.2 5H7zm2 1.5A1.5 1.5 0 1 1 9 9.5 1.5 1.5 0 0 1 9 6.5z';

export const NODE_GLYPH_PATHS = {
  person: PERSON_SILHOUETTE_PATH,
  space: SPACE_SILHOUETTE_PATH,
  group: GROUP_SILHOUETTE_PATH,
  event: EVENT_SILHOUETTE_PATH,
  resource: RESOURCE_SILHOUETTE_PATH,
  connector: CONNECTOR_SILHOUETTE_PATH,
  agent: AGENT_SILHOUETTE_PATH,
  tool: TOOL_SILHOUETTE_PATH,
  model: MODEL_SILHOUETTE_PATH,
  custom: CUSTOM_SILHOUETTE_PATH,
} as const;

export type NodeGlyph = keyof typeof NODE_GLYPH_PATHS;

/** Glyphs whose holes are drawn by the even-odd rule rather than reversed winding. */
export const NODE_GLYPH_FILL_RULE: Partial<Record<NodeGlyph, 'evenodd'>> = {
  event: 'evenodd',
};

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
