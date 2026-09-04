'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJsonBody } from '@/lib/fetchJson';
import { draftHref } from '@/lib/create/rows';
import { TAG_SWATCHES } from '@/lib/tagColors';
import { defaultNodeTypeColor, mergeNodeType } from '@/lib/types/nodeTypeRegistry';
import { FormFooter, fieldClass, useAutoFocus, useCreateSubmit, type InlineFormProps } from './shared';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';

/**
 * A type the space has not used yet: its name and its colour. The name comes
 * in from the search when the panel was searched, and is typed here when the
 * row was taken from the top of the list — either way this is the one form,
 * so "New type" is a thing you can press rather than a row you have to
 * summon by naming it.
 *
 * Registering it is one PATCH; the first note of that type is then written on
 * the draft surface. The same `mergeNodeType` the route runs decides here
 * whether the name is legal, so a refusal is shown before the write.
 */
export default function NewTypeForm({ spaceId, name: initialName, folder, onDone }: InlineFormProps & { name: string }) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(() => defaultNodeTypeColor(initialName || 'type'));
  const [touchedColor, setTouchedColor] = useState(false);
  const { currentSpace, refreshSpace } = useSpace();
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  const merged = useMemo(
    () => mergeNodeType(currentSpace?.nodeTypes, { name }),
    [currentSpace, name],
  );
  // A name nobody has used is the only one this form can write: anything else
  // already has a row of its own in the list behind it.
  const problem = !name.trim()
    ? null
    : !merged.ok
      ? merged.error
      : !merged.created
        ? `“${merged.type.name}” already exists here.`
        : null;
  const swatch = touchedColor ? color : defaultNodeTypeColor(name || 'type');

  const run = useCallback(async () => {
    await fetchJsonBody(`/api/communities/${encodeURIComponent(spaceId)}/node-types`, 'PATCH', {
      name: name.trim(),
      color: swatch,
    });
    // The draft reads the type off the space record; land there with it known.
    await refreshSpace();
    return draftHref(name.trim(), folder);
  }, [spaceId, name, swatch, folder, refreshSpace]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        ref={nameRef}
        className={fieldClass}
        placeholder="Type name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
      />
      <div className="flex flex-wrap gap-2 px-0.5" role="radiogroup" aria-label="Colour">
        {TAG_SWATCHES.map((s) => {
          const active = s.toLowerCase() === swatch.toLowerCase();
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={s}
              onClick={() => { setTouchedColor(true); setColor(s); }}
              className={`h-6 w-6 rounded-full transition-transform ${active ? 'scale-110 ring-2 ring-offset-2 ring-offset-surface-1' : 'hover:scale-105'}`}
              style={{ background: s, ['--tw-ring-color' as string]: s }}
            />
          );
        })}
      </div>
      <FormFooter ready={Boolean(name.trim()) && !problem} saving={saving} error={error ?? problem} />
    </form>
  );
}
