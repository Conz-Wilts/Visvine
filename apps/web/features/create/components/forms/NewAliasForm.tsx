'use client';

import { useCallback, useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { fetchJsonBody } from '@/lib/fetchJson';
import { aliasNameError, MAX_ALIAS_NAME } from '@/lib/notes/shared/aliases';
import { TAG_SWATCHES } from '@/lib/tagColors';
import { aliasesForType, personAliases, type SpaceAlias } from '@/lib/types';
import { FormFooter, fieldClass, useAutoFocus, useCreateSubmit } from './shared';

/**
 * A new alias for one kind — Founder under Person, Portfolio under Space:
 * the name and the colour its chip is worn in, made where the kind's own
 * aliases are listed rather than in the console, because the moment you want
 * one is the moment you are creating something that would wear it.
 *
 * It writes through the same door the console does (`/api/aliases`,
 * lib/notes/typeAliases.ts) — a Person alias is the space's permission
 * vocabulary, so nothing else may mint one — and hands the alias back rather
 * than a page: the panel carries it straight into the kind's form, with the
 * alias already on.
 */
export default function NewAliasForm({
  spaceId,
  nodeType,
  accent,
  onCreated,
}: {
  spaceId: string;
  /** The kind the alias narrows, spelled as the space spells it ("Person"). */
  nodeType: string;
  /** The kind's colour, which the alias starts out wearing. */
  accent: string;
  onCreated: (alias: SpaceAlias) => void;
}) {
  const { currentSpace, refreshSpace } = useSpace();
  const [name, setName] = useState('');
  const [color, setColor] = useState(accent);
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  const all = (currentSpace?.aliases as SpaceAlias[] | undefined) ?? [];
  const existing = nodeType.toLowerCase() === 'person' ? personAliases(all) : aliasesForType(all, nodeType);
  const problem = name.trim() ? aliasNameError(name, existing.map((a) => a.name)) : null;

  const run = useCallback(async () => {
    const alias: SpaceAlias = { name: name.trim(), color, nodeType };
    await fetchJsonBody('/api/aliases', 'POST', { spaceId, action: 'create', ...alias });
    // The form it lands on reads the space's aliases; land there with it known.
    await refreshSpace();
    return alias;
  }, [spaceId, name, color, nodeType, refreshSpace]);
  const { saving, error, submit } = useCreateSubmit(run, onCreated);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        ref={nameRef}
        className={fieldClass}
        placeholder="Alias name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={MAX_ALIAS_NAME}
      />
      <div className="flex flex-wrap gap-2 px-0.5" role="radiogroup" aria-label="Colour">
        {[accent, ...TAG_SWATCHES.filter((s) => s.toLowerCase() !== accent.toLowerCase())].map((s) => {
          const active = s.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={s}
              onClick={() => setColor(s)}
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
