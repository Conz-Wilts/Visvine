'use client';

import { useEffect, useState } from 'react';
import { IconButton, Skeleton, ZOOM_IDENTITY, type ZoomState } from '@visvine/ui';
import { DownloadIcon, ExternalLinkIcon, Maximize2Icon } from '@/features/shared/icons';
import { fetchJson } from '@/lib/fetchJson';
import { swrFetch } from '@/features/shared/lib/requestCache';
import type { ResourceView } from '@/lib/resources/shared/view';
import Stage from './Stage';
import { resourceViewKey } from './ResourceViewerHost';
import { useResourceViewer } from './ResourceViewerContext';

/**
 * A resource drawn in place — a node page's Preview tab — by the same stage
 * the viewer uses, with the way out to the real thing and up to full screen.
 */
export default function InlineResource({ resourceId, className = '' }: { resourceId: string; className?: string }) {
  const [resource, setResource] = useState<ResourceView | null>(null);
  const [zoom, setZoom] = useState<ZoomState>(ZOOM_IDENTITY);
  const viewer = useResourceViewer();

  useEffect(() => {
    let cancelled = false;
    swrFetch(
      resourceViewKey(resourceId),
      () => fetchJson<{ resource: ResourceView }>(`/api/resources/${encodeURIComponent(resourceId)}/view`),
      (data) => !cancelled && setResource(data.resource),
    ).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resourceId]);

  if (!resource) return <Skeleton className={`min-h-[60vh] w-full rounded-none ${className}`} />;
  const r = resource;
  const openHere = r.source === 'link' && r.url;
  return (
    <div className={`relative flex min-h-[60vh] flex-col bg-surface-muted ${className}`}>
      <div className="absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-float">
        {openHere ? (
          <IconButton label={`Open in ${r.providerLabel}`} icon={<ExternalLinkIcon />} onClick={() => window.open(r.url!, '_blank', 'noopener,noreferrer')} />
        ) : r.downloadUrl ? (
          <IconButton label="Download" icon={<DownloadIcon />} onClick={() => (window.location.href = r.downloadUrl!)} />
        ) : null}
        <IconButton label="Full screen" icon={<Maximize2Icon />} onClick={() => viewer.open(r.id)} />
      </div>
      <div className="relative min-h-0 flex-1">
        <Stage
          resource={r}
          full={false}
          zoom={zoom}
          onZoom={setZoom}
          onDownload={() => r.downloadUrl && (window.location.href = r.downloadUrl)}
        />
      </div>
    </div>
  );
}
