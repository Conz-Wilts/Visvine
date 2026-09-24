'use client';

/**
 * Pick an event's poster from a picture the space already holds — the
 * resources image grid, which is what makes choosing the logo quick.
 *
 * Choosing posts the resource's id — never its bytes and never its signed
 * URL — to the event's cover route, which copies it inside the space
 * (lib/events/cover.ts). It is the same call the MCP create_event action
 * makes with `cover_resource_id`, so a person and an agent set a cover the
 * same way.
 */

import { useState } from 'react';
import { Alert } from '@visvine/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import ResourcePicker from '@/features/resources/components/ResourcePicker';
import type { NBEvent } from '@/lib/types';

interface Props {
  spaceId: string;
  eventId: string;
  onClose: () => void;
  /** The saved event, so the composer can take the cover URL it now carries. */
  onPicked: (event: NBEvent) => void;
}

export function DriveCoverPicker({ spaceId, eventId, onClose, onPicked }: Props) {
  const [error, setError] = useState<string | null>(null);

  const pick = async (resourceId: string) => {
    setError(null);
    try {
      const event = await fetchJsonBody<NBEvent>(
        `/api/events/${encodeURIComponent(eventId)}/cover?spaceId=${encodeURIComponent(spaceId)}`,
        'POST',
        { resourceId },
      );
      onPicked(event);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that image');
    }
  };

  return (
    <>
      <ResourcePicker
        spaceId={spaceId}
        open
        kind="image"
        title="Cover image"
        onClose={() => !error && onClose()}
        onPick={([picked]) => picked && void pick(picked.id)}
      />
      {error && (
        <div className="fixed bottom-6 left-1/2 z-(--vv-z-toast) -translate-x-1/2 rounded-lg bg-surface px-3 py-2 shadow-float">
          <Alert variant="error" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
    </>
  );
}
