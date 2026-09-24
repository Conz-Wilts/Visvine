'use client';

import { useState } from 'react';
import { ZOOM, ZoomPane } from '@visvine/ui';
import { imageSourceOf } from '../registry';
import type { RendererProps } from './types';

/**
 * An image, fitted to the stage and zoomable toward the cursor. Drawn from
 * the original wherever the browser can decode it, so saving it saves the
 * original; where a rendition must stand in, the browser's own "Save image"
 * is withheld and Download (which always serves the original) is the way.
 */
export default function ImageRenderer({ resource, zoom, onZoom }: RendererProps) {
  const source = imageSourceOf(resource);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  if (!source) return null;
  return (
    <ZoomPane state={zoom} onChange={onZoom} max={ZOOM.maxImage} contentSize={size}>
      <img
        src={source.src}
        alt={resource.name}
        draggable={false}
        onLoad={(e) => setSize({ width: e.currentTarget.clientWidth, height: e.currentTarget.clientHeight })}
        onContextMenu={source.isOriginal ? undefined : (e) => e.preventDefault()}
        className="max-h-[calc(100vh-10rem)] max-w-full object-contain shadow-float"
      />
    </ZoomPane>
  );
}
