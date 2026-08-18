/**
 * The rail icon an installed Tool renders with.
 *
 * A Tool names one of `TOOL_RAIL_ICONS` (lib/tools/config.ts) in its
 * frontmatter, and this is where that name becomes a glyph. The names are a
 * stable public contract — a published Tool's frontmatter refers to them — so
 * they stay as they are and map onto the owned icon set here, rather than being
 * icon file names themselves.
 *
 * The glyphs used to be drawn inline in this file. They now live in
 * `assets/icons/tool-*.svg` with the rest of the set (see docs/icons.md), drawn
 * to the same 24x24 / 1.8-stroke / currentColor spec as the built-in rail rows,
 * so an installed Tool's row is indistinguishable from a built-in one and
 * inherits the active pill's colour transition for free.
 *
 * A Tool may also ship its OWN glyph (`surfaces.rail.icon: custom` plus an
 * `icon.svg`), which is the one case where markup an author wrote renders in
 * the app's own document rather than inside the Tool's sandbox. That markup is
 * sanitized at BUILD time by lib/tools/iconSvg.ts and stored sanitized, so this
 * component renders it without re-parsing — the trust boundary is the build,
 * not the render. Do not route unsanitized markup through `svg` here.
 */
import { Icon, IconBase } from '@/features/shared/icons';

/** Same class the built-in feature icons use — see features/shared/lib/features.tsx. */
const iconClass = 'h-5 w-5 shrink-0';

/**
 * `TOOL_RAIL_ICONS` name -> owned glyph. A plain record rather than a switch so
 * a name that set gains without a glyph here is a missing key (which falls back
 * below) instead of a hole in the rail.
 */
const RAIL_GLYPHS: Record<string, string> = {
  grid: 'tool-grid',
  kanban: 'tool-kanban',
  list: 'tool-list',
  table: 'tool-table',
  calendar: 'tool-calendar',
  chart: 'tool-chart',
  note: 'tool-note',
  folder: 'tool-folder',
  people: 'tool-people',
  sparkle: 'tool-sparkle',
};

/**
 * The glyph for a Tool's declared rail icon. Unknown or absent names fall back
 * to `grid` — `parseToolConfig` already refuses an icon outside the set, so this
 * only catches an install pinned to a version published before a name existed,
 * and a hole in the sidebar would be worse than the wrong shape.
 */
export default function ToolIcon({
  name,
  svg,
}: {
  name: string | null | undefined;
  /** The Tool's own glyph, ALREADY SANITIZED (lib/tools/iconSvg.ts). */
  svg?: string | null;
}) {
  // The author's glyph wins when there is one, whatever the name says — a Tool
  // that shipped an icon and then edited its frontmatter should not lose it
  // silently. `IconBase` supplies the box and the paint, so the stored markup
  // only ever contributes geometry.
  if (svg) {
    return (
      <IconBase className={iconClass} strokeWidth={1.8} html={svg} />
    );
  }
  const glyph = RAIL_GLYPHS[(name ?? '').trim().toLowerCase()] ?? RAIL_GLYPHS.grid;
  return <Icon name={glyph} className={iconClass} />;
}
