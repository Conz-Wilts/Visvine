'use client';

import LinkPreviewCard from '@/features/shared/components/LinkPreviewCard';
import { usePulledCards } from '@/features/resources/hooks/usePulledCards';
import { XIcon } from '@/features/shared/icons';
import type { SerializedLinkPreview } from '@/lib/messages/types';

/**
 * A message's link cards. A card whose unfurl is still owed is drawn as a
 * skeleton and pulled until it lands; its author can take a card off the
 * message (the link stays in the text, the resource wherever else it was
 * shared).
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
  if (!shown.length) return null;

  const remove = (resourceId: string) => {
    if (!conversationId) return;
    void fetch(
      `/api/messages/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/shares/${encodeURIComponent(resourceId)}`,
      { method: 'DELETE' },
    );
  };

  return (
    <>
      {shown.map((card) =>
        card.pending && !card.title ? (
          <div key={card.resourceId ?? card.url} className="mt-2 flex max-w-md items-center gap-3 rounded-xl border border-line-subtle px-3 py-2.5">
            <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm bg-surface-muted" />
            <div className="h-3 flex-1 animate-pulse rounded bg-surface-muted" />
          </div>
        ) : (
          <div key={card.resourceId ?? card.url} className="group/card relative max-w-md">
            <LinkPreviewCard preview={card} />
            {canRemove && card.resourceId && conversationId && (
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
        ),
      )}
    </>
  );
}
