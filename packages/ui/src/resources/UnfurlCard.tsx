'use client';

import { clsx } from 'clsx';
import { useState } from 'react';

export interface UnfurlCardData {
  url: string;
  title?: string | null;
  description?: string | null;
  /** An image of ours (re-hosted), never the page's own address. */
  imageUrl?: string | null;
  siteName?: string | null;
  faviconUrl?: string | null;
  /** `summary`: a small square beside the text; `large`: a wide image above it. */
  imageLayout?: 'summary' | 'large' | null;
  /** The unfurl has not landed yet. */
  pending?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * A link as Slack lays it out: the site (icon and name) on one muted line,
 * the title, the description, and the picture — wide above the text for a
 * `large` card, a small square beside it for a `summary` one. Pressing it
 * opens the viewer when `onOpen` is given, else the page in a new tab.
 */
export default function UnfurlCard({
  card,
  onOpen,
  className = 'mt-2 max-w-md',
}: {
  card: UnfurlCardData;
  onOpen?: () => void;
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const [iconFailed, setIconFailed] = useState(false);
  const site = card.siteName || hostOf(card.url);
  const image = card.imageUrl && !imageFailed ? card.imageUrl : null;
  const summary = card.imageLayout === 'summary';

  if (card.pending && !card.title) {
    return (
      <div className={clsx('flex items-center gap-3 rounded-xl border border-line-subtle px-3 py-2.5', className)} aria-busy="true">
        <span className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-sm bg-surface-muted" />
        <span className="h-3 flex-1 animate-pulse rounded bg-surface-muted" />
      </div>
    );
  }
  if (!card.title && !card.description && !image) return null;

  const body = (
    <>
      {image && !summary && <img src={image} alt="" className="max-h-60 w-full object-cover" loading="lazy" onError={() => setImageFailed(true)} />}
      <span className="flex gap-3 px-3 py-2.5">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            {card.faviconUrl && !iconFailed && (
              <img src={card.faviconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" loading="lazy" onError={() => setIconFailed(true)} />
            )}
            <span className="truncate">{site}</span>
          </span>
          {card.title && <span className="mt-0.5 line-clamp-2 block text-sm font-medium text-fg">{card.title}</span>}
          {card.description && <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{card.description}</span>}
        </span>
        {image && summary && <img src={image} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" onError={() => setImageFailed(true)} />}
      </span>
    </>
  );
  const frame = clsx(
    'block overflow-hidden rounded-xl border border-line-subtle bg-surface text-left transition-colors hover:bg-surface-subtle',
    className,
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={clsx(frame, 'w-full')}>
      {body}
    </button>
  ) : (
    <a href={card.url} target="_blank" rel="noopener noreferrer" className={frame}>
      {body}
    </a>
  );
}
