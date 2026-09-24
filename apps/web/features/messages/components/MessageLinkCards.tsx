'use client';

import { UnfurlCard } from '@visvine/ui';
import { usePulledCards } from '@/features/resources/hooks/usePulledCards';
import { useResourceViewer } from '@/features/resources/viewer/ResourceViewerContext';
import { XIcon } from '@/features/shared/icons';
import type { SerializedLinkPreview } from '@/lib/messages/types';

/**
 * A message's link cards. Pressing one opens it in the viewer (a live embed
 * for an allowlisted provider, its card otherwise); a card still waiting on
 * its unfurl is drawn as a skeleton and pulled until it lands. Its author can
 * take a card off the message — the link stays in the text, the resource
 * wherever else it was shared.
 */
export default function MessageLinkCards({
  cards,
  messageId,
  conversationId,
  canRemove,
}: {
  cards: SerializedLinkPreview[] | undefined;
  messageId: string;
  conversationId?: string;
  canRemove: boolean;
}) {
  const shown = usePulledCards(cards);
  const viewer = useResourceViewer();
  if (!shown.length) return null;
  const ids = shown.map((card) => card.resourceId).filter((id): id is string => !!id);

  const remove = (resourceId: string) => {
    if (!conversationId) return;
    void fetch(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/shares/${encodeURIComponent(resourceId)}`,
      { method: 'DELETE' },
    );
  };

  return (
    <>
      {shown.map((card) => (
        <div key={card.resourceId ?? card.url} className="group/card relative max-w-md">
          <UnfurlCard
            card={card}
            onOpen={card.resourceId ? () => viewer.open(card.resourceId!, ids) : undefined}
          />
          {canRemove && card.resourceId && conversationId && !card.pending && (
            <button
              type="button"
              onClick={() => remove(card.resourceId!)}
              aria-label="Remove preview"
              title="Remove preview"
              className="absolute right-1.5 top-3.5 hidden rounded-full bg-surface p-1 text-fg-muted shadow-float hover:text-fg group-hover/card:block"
            >
              <XIcon className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </>
  );
}
