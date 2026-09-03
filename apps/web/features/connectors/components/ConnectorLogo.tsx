'use client';

import { PlugIcon } from '@/features/shared/icons';
import { catalogEntryFor } from '@/lib/connectors/catalog';

/**
 * A connector's mark: the service's logo where the note came from a catalog
 * recipe, and the plug otherwise — a connector the space wrote itself has no
 * logo to show, and a square that says "connector" beats an empty box.
 *
 * The same component on both surfaces (the console's Connectors list and the
 * connector's own page) so a row and the page it opens carry one mark — and
 * on a model's row and page too, handed the model catalogue's entry. Pass
 * `entry` where the catalogue row is already in hand; pass `name` (plus the
 * note's `recipe`) where all there is is a connector note. `recipe` is what
 * keeps the mark right on a second connection to one service, whose name is
 * `google-drive-2` rather than `google-drive`.
 */

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', glyph: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-lg', glyph: 'h-5 w-5' },
  lg: { box: 'h-12 w-12 rounded-xl', glyph: 'h-6 w-6' },
};

export default function ConnectorLogo({
  entry,
  name,
  recipe,
  size = 'md',
}: {
  /** Any catalogue row with a logo — a connector's or a model's. */
  entry?: { logo: string } | null;
  name?: string;
  /** The note's `recipe:` — the service, where the name no longer says it. */
  recipe?: string | null;
  size?: keyof typeof SIZES;
}) {
  const resolved = entry ?? (name ? catalogEntryFor(name, recipe) : null);
  const { box, glyph } = SIZES[size];
  return (
    <div className={`${box} flex shrink-0 items-center justify-center bg-surface-2`}>
      {resolved ? (
        <img src={`/images/connectors/${resolved.logo}`} alt="" className={`${glyph} object-contain`} />
      ) : (
        <PlugIcon className={`${glyph} text-text-muted`} />
      )}
    </div>
  );
}
