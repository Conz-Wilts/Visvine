'use client';

import { useEffect, useState } from 'react';
import { Button, UnfurlCard } from '@visvine/ui';
import { usePulledCards } from '@/features/resources/hooks/usePulledCards';
import type { RendererProps } from './types';

/** An embed that has not loaded in this long is replaced by the card. */
const EMBED_TIMEOUT_MS = 8_000;

/**
 * A link. An allowlisted provider (Google Docs, YouTube, Figma…) is framed
 * live, in a sandbox, from the embed URL we built — and falls back to the
 * card when it will not load. Everything else is the card, large, with the
 * way to open the real thing.
 */
export default function LinkRenderer({ resource }: RendererProps) {
  const [card] = usePulledCards(resource.card ? [resource.card] : []);
  const [embed, setEmbed] = useState<'loading' | 'loaded' | 'failed'>(resource.embedUrl ? 'loading' : 'failed');

  useEffect(() => {
    if (embed !== 'loading') return;
    const timer = setTimeout(() => setEmbed((s) => (s === 'loading' ? 'failed' : s)), EMBED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [embed]);

  const open = () => resource.url && window.open(resource.url, '_blank', 'noopener,noreferrer');

  if (resource.embedUrl && embed !== 'failed') {
    const player = ['youtube', 'vimeo', 'loom'].includes(resource.provider ?? '');
    return (
      <div className={`flex h-full w-full items-center justify-center ${player ? 'bg-black' : ''}`}>
        <iframe
          src={resource.embedUrl}
          title={resource.name}
          onLoad={() => setEmbed('loaded')}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className={player ? 'aspect-video w-full max-w-5xl border-0' : 'h-full w-full border-0 bg-surface'}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-4 text-center">
        {card && <UnfurlCard card={{ ...card, imageLayout: card.imageUrl ? 'large' : null }} className="w-full" />}
        <Button variant="brand" onClick={open}>
          Open in {resource.providerLabel}
        </Button>
      </div>
    </div>
  );
}
