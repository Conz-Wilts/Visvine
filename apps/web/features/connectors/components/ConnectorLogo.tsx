'use client';

import { PlugIcon } from '@/features/shared/icons';
import { catalogEntryFor, type CatalogEntry } from '@/lib/connectors/catalog';

/**
 * A connector's mark: the service's logo where the note came from a catalog
 * recipe, and the plug otherwise — a connector the space wrote itself has no
 * logo to show, and a square that says "connector" beats an empty box.
 *
 * The same component on both surfaces (the console's Connectors list and the
 * connector's own page) so a row and the page it opens carry one mark. Pass
 * `entry` where the catalog row is already in hand; pass `name` (plus
 * `provider`, for a model connector) where all there is is a note.
 */

const SIZES = {
  sm: { box: 'h-8 w-8 rounded-lg', glyph: 'h-4 w-4' },
  md: { box: 'h-10 w-10 rounded-lg', glyph: 'h-5 w-5' },
  lg: { box: 'h-12 w-12 rounded-xl', glyph: 'h-6 w-6' },
};

export default function ConnectorLogo({
  entry,
  name,
  provider,
  size = 'md',
}: {
  entry?: CatalogEntry | null;
  name?: string;
  provider?: string | null;
  size?: keyof typeof SIZES;
}) {
  const resolved = entry ?? (name ? catalogEntryFor(name, provider) : null);
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
