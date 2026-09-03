'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChannelIcon, ChannelIconPicker } from '@/features/messages/components/ChannelIcon';
import { fetchJsonBody } from '@/lib/fetchJson';
import type { ChannelSectionEntry, ChannelViewMode } from '@/lib/messages/types';
import { DOCK_MS } from '@/features/shared/contexts/SidebarContext';
import { FormFooter, Segmented, fieldClass, useAutoFocus, useCreateSubmit, type InlineFormProps } from './shared';

const VIEWS = [
  { value: 'CHAT', label: 'Chat' },
  { value: 'FEED', label: 'Feed' },
] as const satisfies readonly { value: ChannelViewMode; label: string }[];

/** A channel: its icon and name, how it reads, and the section it files under. */
export default function ChannelForm({ spaceId, accent, onDone }: InlineFormProps) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ChannelViewMode>('CHAT');
  const [sectionId, setSectionId] = useState('');
  const [sections, setSections] = useState<ChannelSectionEntry[]>([]);
  const [pickingIcon, setPickingIcon] = useState(false);
  const nameRef = useAutoFocus<HTMLInputElement>(DOCK_MS);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/messages/sections?spaceId=${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((payload) => { if (!cancelled) setSections(payload.sections ?? []); })
      .catch(() => { if (!cancelled) setSections([]); });
    return () => { cancelled = true; };
  }, [spaceId]);

  const run = useCallback(async () => {
    const { conversation } = await fetchJsonBody<{ conversation: { id: string } }>(
      '/api/messages/conversations/channel',
      'POST',
      { spaceId, name: name.trim(), icon: icon ?? undefined, sectionId: sectionId || undefined, viewMode },
    );
    return `/channels/${encodeURIComponent(conversation.id)}`;
  }, [spaceId, name, icon, sectionId, viewMode]);
  const { saving, error, submit } = useCreateSubmit(run, onDone);

  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <div className="flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setPickingIcon((v) => !v)}
            aria-label="Channel icon"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-secondary transition-colors hover:text-text-primary"
          >
            <ChannelIcon icon={icon} className="h-4 w-4" />
          </button>
          {pickingIcon && (
            <div className="absolute left-0 top-10 z-30">
              <ChannelIconPicker
                onSelect={(next) => { setIcon(next); setPickingIcon(false); }}
                onClear={icon ? () => { setIcon(null); setPickingIcon(false); } : undefined}
                onClose={() => setPickingIcon(false)}
              />
            </div>
          )}
        </div>
        <input
          ref={nameRef}
          className={fieldClass}
          placeholder="Channel name"
          aria-label="Channel name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Segmented value={viewMode} options={VIEWS} onPick={setViewMode} accent={accent} />
      {sections.length > 0 && (
        <select
          className={fieldClass}
          aria-label="Section"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          <option value="">No section</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      <FormFooter ready={name.trim().length > 0} saving={saving} error={error} />
    </form>
  );
}
