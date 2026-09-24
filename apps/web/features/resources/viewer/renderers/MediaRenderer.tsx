'use client';

import type { RendererProps } from './types';

/** A video or an audio track, played by the browser from the original (ranges seek). */
export default function MediaRenderer({ resource }: RendererProps) {
  if (!resource.rawUrl) return null;
  if (resource.kind === 'audio') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <audio src={resource.rawUrl} controls preload="metadata" className="w-full max-w-lg" />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-black p-0">
      <video
        src={resource.rawUrl}
        poster={resource.posterUrl ?? undefined}
        controls
        preload="metadata"
        playsInline
        className="max-h-full max-w-full"
      />
    </div>
  );
}
