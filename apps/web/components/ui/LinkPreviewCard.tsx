'use client';

import type { SerializedLinkPreview } from '@/lib/messages/types';
import { hostOf } from '@/lib/links/shared/unfurl';

// A link's unfurl card — shared between message rows, feed posts and the
// resource Preview tab. Laid out the way Slack lays one out: the site (favicon
// and name) in one muted line, the title, the description, and the image —
// wide above the text for a `large` card, a small square beside it for a
// `summary` one. Width defaults to the chat sizing; override via className.
export default function LinkPreviewCard({
  preview,
  className = 'mt-2 max-w-md',
}: {
  preview: SerializedLinkPreview;
  className?: string;
}) {
  if (!preview.title && !preview.description && !preview.imageUrl) return null;
  const site = preview.siteName ?? hostOf(preview.url);
  const summary = preview.imageLayout === 'summary';

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border border-line-subtle bg-surface-subtle/60 overflow-hidden hover:bg-surface-subtle transition-colors ${className}`}
    >
      {preview.imageUrl && !summary && (
        <img src={preview.imageUrl} alt="" className="max-h-56 w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
      )}
      <div className="flex gap-3 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
            {preview.faviconUrl && (
              <img
                src={preview.faviconUrl}
                alt=""
                className="h-3.5 w-3.5 shrink-0 rounded-sm"
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            )}
            <span className="truncate">{site}</span>
          </p>
          {preview.title && (
            <p className="mt-0.5 text-sm font-medium text-fg line-clamp-2">{preview.title}</p>
          )}
          {preview.description && (
            <p className="mt-0.5 text-xs text-fg-muted line-clamp-2">{preview.description}</p>
          )}
        </div>
        {preview.imageUrl && summary && (
          <img src={preview.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" loading="lazy" referrerPolicy="no-referrer" />
        )}
      </div>
    </a>
  );
}
