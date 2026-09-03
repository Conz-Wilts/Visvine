'use client';

import { useCallback, useState } from 'react';
import { fetchJsonBody } from '@/lib/fetchJson';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { FormFooter, fieldClass, useAutoFocus, useCreateSubmit, type InlineFormProps } from './shared';

/** A section: a name for a group of channels. */
export default function SectionForm({ spaceId, onDone }: InlineFormProps) {
  const [name, setName] = useState('');
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  const run = useCallback(async () => {
    await fetchJsonBody('/api/messages/sections', 'POST', { spaceId, name: name.trim() });
    return '/channels';
  }, [spaceId, name]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input
        ref={nameRef}
        className={fieldClass}
        placeholder="Section name"
        aria-label="Section name"
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <FormFooter ready={name.trim().length > 0} saving={saving} error={error} />
    </form>
  );
}
