'use client';

import { useCallback } from 'react';
import { fetchJsonBody } from '@/lib/fetchJson';
import { useDraftCommit, type DraftKindProps } from './shared';

/**
 * A section: a name for a group of channels, and nothing else. It has no note
 * and no fields of its own, so this contributes no rows — the draft's title IS
 * the whole of it, and the surface hides its editor for that reason.
 */
export default function SectionSetup({ shared, onReadyChange, registerCommit }: DraftKindProps) {
  const { spaceId, title } = shared;

  const commit = useCallback(async () => {
    await fetchJsonBody('/api/messages/sections', 'POST', { spaceId, name: title.trim() });
    return '/channels';
  }, [spaceId, title]);

  useDraftCommit({ onReadyChange, registerCommit }, title.trim().length > 0, commit);
  return null;
}
