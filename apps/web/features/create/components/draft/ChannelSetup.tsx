'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChannelIcon, ChannelIconPicker } from '@/features/messages/components/ChannelIcon';
import { fetchJsonBody } from '@/lib/fetchJson';
import type { ChannelSectionEntry, ChannelViewMode } from '@/lib/messages/types';
import { fieldClass, Segmented, SetupSection, useDraftCommit, type DraftKindProps } from './shared';

const VIEWS = [
  { value: 'CHAT', label: 'Chat' },
  { value: 'FEED', label: 'Feed' },
] as const satisfies readonly { value: ChannelViewMode; label: string }[];

/**
 * A channel: the title above names it, the prose below becomes its context
 * note (channels/<slug>.md — the channel has one either way, this just writes
 * its first paragraph), and this surface owns the three facts a conversation
 * needs that a note does not — the icon it wears, whether it reads as chat or
 * as a feed, and the section it files under.
 */
export default function ChannelSetup({ shared, onReadyChange, registerCommit }: DraftKindProps) {
  const { spaceId, title, accent } = shared;
  const [icon, setIcon] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ChannelViewMode>('CHAT');
  const [sectionId, setSectionId] = useState('');
  const [sections, setSections] = useState<ChannelSectionEntry[]>([]);
  const [pickingIcon, setPickingIcon] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/messages/sections?spaceId=${encodeURIComponent(spaceId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((payload) => { if (!cancelled) setSections(payload.sections ?? []); })
      .catch(() => { if (!cancelled) setSections([]); });
    return () => { cancelled = true; };
  }, [spaceId]);

  const commit = useCallback(async () => {
    const { conversation } = await fetchJsonBody<{ conversation: { id: string } }>(
      '/api/messages/conversations/channel',
      'POST',
      {
        spaceId,
        name: title.trim(),
        // The channel's context note, which the create call writes for us.
        context: shared.body().trim().slice(0, 5000) || undefined,
        icon: icon ?? undefined,
        sectionId: sectionId || undefined,
        viewMode,
      },
    );
    return `/channels/${encodeURIComponent(conversation.id)}`;
  }, [spaceId, title, icon, sectionId, viewMode, shared]);

  useDraftCommit({ onReadyChange, registerCommit }, title.trim().length > 0, commit);

  return (
    <SetupSection label="How it reads">
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
        <div className="min-w-0 flex-1">
          <Segmented value={viewMode} options={VIEWS} onPick={setViewMode} accent={accent} />
        </div>
      </div>
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
    </SetupSection>
  );
}
