'use client';

import { useCallback, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJsonBody } from '@/lib/fetchJson';
import { draftHref } from '@/lib/create/rows';
import { TAG_SWATCHES } from '@/lib/tagColors';
import { defaultNodeTypeColor } from '@/lib/types/nodeTypeRegistry';
import { FormFooter, useCreateSubmit, type InlineFormProps } from './shared';

/**
 * A type the space has not used yet: the name was typed in the search, so the
 * only choice left is its colour. Registering it is one PATCH; the first note
 * of that type is then written on the draft surface.
 */
export default function NewTypeForm({ spaceId, name, folder, onDone }: InlineFormProps & { name: string }) {
  const [color, setColor] = useState(defaultNodeTypeColor(name));
  const { refreshSpace } = useSpace();

  const run = useCallback(async () => {
    await fetchJsonBody(`/api/communities/${encodeURIComponent(spaceId)}/node-types`, 'PATCH', { name, color });
    // The draft reads the type off the space record; land there with it known.
    await refreshSpace();
    return draftHref(name, folder);
  }, [spaceId, name, color, folder, refreshSpace]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="flex flex-wrap gap-2 px-0.5" role="radiogroup" aria-label="Colour">
        {TAG_SWATCHES.map((swatch) => {
          const active = swatch.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={swatch}
              onClick={() => setColor(swatch)}
              className={`h-6 w-6 rounded-full transition-transform ${active ? 'scale-110 ring-2 ring-offset-2 ring-offset-surface-1' : 'hover:scale-105'}`}
              style={{ background: swatch, ['--tw-ring-color' as string]: swatch }}
            />
          );
        })}
      </div>
      <FormFooter ready saving={saving} error={error} />
    </form>
  );
}
