'use client';

import type { SerializedLinkPreview } from '@/lib/messages/types';

// OpenGraph unfurl card — shared between message rows and the resource
// Preview tab. Width defaults to the chat sizing; override via className.
export default function LinkPreviewCard({
  preview,
  className = 'mt-2 max-w-md',
}: {
  preview: SerializedLinkPreview;
  className?: string;
}) {
  if (!preview.title && !preview.description) return null;

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block rounded-xl border border-border-subtle bg-surface-2/60 overflow-hidden hover:bg-surface-2 transition-colors ${className}`}
    >
      {preview.imageUrl && (
        <img src={preview.imageUrl} alt="" className="h-32 w-full object-cover" loading="lazy" />
      )}
      <div className="px-3 py-2">
        {preview.siteName && (
          <p className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{preview.siteName}</p>
        )}
        {preview.title && (
          <p className="text-sm font-medium text-text-primary line-clamp-2">{preview.title}</p>
        )}
        {preview.description && (
          <p className="mt-0.5 text-xs text-text-muted line-clamp-2">{preview.description}</p>
        )}
      </div>
    </a>
  );
}
