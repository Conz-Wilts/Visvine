import { THEME_ACCENT, PERSON_SILHOUETTE_PATH } from './avatarGlyphs';
import { palette } from '@visvine/tokens';

interface PersonSilhouetteProps {
  /** Fill colour of the silhouette (the accent/theme colour). Defaults to the theme accent. */
  color?: string;
  className?: string;
}

/**
 * Canonical avatar fallback for people: a white person silhouette on an
 * accent/theme-coloured fill, shown when no profile image is available. Fills
 * its parent, so the parent controls shape (rounding) and size.
 */
export default function PersonSilhouette({ color = THEME_ACCENT, className = '' }: PersonSilhouetteProps) {
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
        <path d={PERSON_SILHOUETTE_PATH} />
      </svg>
    </div>
  );
}
