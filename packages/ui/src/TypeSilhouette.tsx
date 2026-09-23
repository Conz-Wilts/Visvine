import { THEME_ACCENT, NODE_GLYPH_PATHS, NODE_GLYPH_FILL_RULE, type NodeGlyph } from './avatarGlyphs';
import { palette } from '@visvine/tokens';

interface TypeSilhouetteProps {
  /** Which node-type glyph to draw (the getNodeGlyph value space). */
  glyph: NodeGlyph;
  /** Fill colour of the silhouette (the accent/theme colour). Defaults to the theme accent. */
  color?: string;
  className?: string;
}

/**
 * Canonical avatar fallback for any node type with a glyph: the type's white
 * silhouette on an accent/theme-coloured fill, shown when no image is available.
 * Generalizes <PersonSilhouette> to the full glyph set (person, group, event,
 * resource). Fills its parent, so the parent controls shape (rounding) and size.
 */
export default function TypeSilhouette({ glyph, color = THEME_ACCENT, className = '' }: TypeSilhouetteProps) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center ${className}`}
      style={{ backgroundColor: color }}
    >
      <svg
        viewBox="0 0 24 24"
        fill={palette.white}
        className="h-[60%] w-[60%]"
        aria-hidden="true"
      >
        <path d={NODE_GLYPH_PATHS[glyph]} fillRule={NODE_GLYPH_FILL_RULE[glyph]} />
      </svg>
    </div>
  );
}
