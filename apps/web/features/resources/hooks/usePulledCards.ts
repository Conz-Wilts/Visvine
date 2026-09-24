'use client';

import { useEffect, useState } from 'react';
import type { SerializedLinkPreview } from '@/lib/messages/types';

/** Pulls wait this long between asks while a card is still pending. */
const RETRY_MS = 4_000;
const MAX_PULLS = 6;

/**
 * Cards whose unfurl has not landed ask the server to finish it
 * (POST /api/resources/jobs/pull — whoever is looking finishes the work) and
 * are redrawn from the answer. Returns the cards with any fresher copy laid
 * over them; a card that was never pending is returned as it came.
 */
export function usePulledCards(cards: SerializedLinkPreview[] | undefined): SerializedLinkPreview[] {
  const [fresh, setFresh] = useState<Record<string, SerializedLinkPreview>>({});
  const waiting = (cards ?? [])
    .filter((card) => card.pending && card.resourceId && !(fresh[card.resourceId] && !fresh[card.resourceId].pending))
    .map((card) => card.resourceId!)
    .sort()
    .join(',');

  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let pulls = 0;
    const pull = async () => {
      pulls++;
      try {
        const res = await fetch('/api/resources/jobs/pull', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: waiting.split(',') }),
        });
        if (!res.ok || stopped) return;
        const body = (await res.json()) as { cards?: Record<string, SerializedLinkPreview> };
        if (body.cards) setFresh((prev) => ({ ...prev, ...body.cards }));
        const still = Object.values(body.cards ?? {}).some((card) => card.pending);
        if (still && pulls < MAX_PULLS && !stopped) setTimeout(() => void pull(), RETRY_MS);
      } catch {
        // The tick finishes it; the next render asks again.
      }
    };
    void pull();
    return () => {
      stopped = true;
    };
  }, [waiting]);

  return (cards ?? []).map((card) => (card.resourceId && fresh[card.resourceId]) || card);
}
