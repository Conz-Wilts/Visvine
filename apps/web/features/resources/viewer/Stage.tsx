'use client';

import dynamic from 'next/dynamic';
import { Button, ViewerFallback, type ZoomState } from '@visvine/ui';
import type { ResourceView } from '@/lib/resources/shared/view';
import { rendererFor, type RendererKind } from './registry';
import type { RendererProps } from './renderers/types';
import { resourceMeta } from './meta';
import ImageRenderer from './renderers/ImageRenderer';
import MediaRenderer from './renderers/MediaRenderer';

// The heavy renderers load only when a resource of their kind is opened.
const PdfRenderer = dynamic(() => import('./renderers/PdfRenderer'), { ssr: false });
const DocxRenderer = dynamic(() => import('./renderers/DocxRenderer'), { ssr: false });
const SheetRenderer = dynamic(() => import('./renderers/SheetRenderer'), { ssr: false });
const TextRenderer = dynamic(() => import('./renderers/TextRenderer'), { ssr: false });
const SlidesRenderer = dynamic(() => import('./renderers/SlidesRenderer'), { ssr: false });
const LinkRenderer = dynamic(() => import('./renderers/LinkRenderer'), { ssr: false });

const RENDERERS: Record<Exclude<RendererKind, 'unsupported'>, React.ComponentType<RendererProps>> = {
  image: ImageRenderer,
  video: MediaRenderer,
  audio: MediaRenderer,
  pdf: PdfRenderer,
  docx: DocxRenderer,
  sheet: SheetRenderer,
  slides: SlidesRenderer,
  markdown: TextRenderer,
  text: TextRenderer,
  'link-embed': LinkRenderer,
  'link-card': LinkRenderer,
};

/** The zoomable renderers, and their ceilings. */
export function zoomMaxOf(resource: ResourceView): number | null {
  const kind = rendererFor(resource);
  if (kind === 'image') return 2;
  if (kind === 'pdf') return 3;
  return null;
}

export default function Stage({
  resource,
  full,
  zoom,
  onZoom,
  onDownload,
  onOpenInApp,
}: {
  resource: ResourceView;
  full: boolean;
  zoom: ZoomState;
  onZoom: (next: ZoomState) => void;
  onDownload: () => void;
  onOpenInApp?: (() => void) | null;
}) {
  const kind = rendererFor(resource);
  if (kind === 'unsupported') {
    return (
      <ViewerFallback
        kind={resource.kind}
        name={resource.name}
        meta={resourceMeta(resource, { people: false })}
        actions={
          <>
            {resource.downloadUrl && (
              <Button variant="brand" onClick={onDownload}>
                Download
              </Button>
            )}
            {onOpenInApp && (
              <Button variant="neutral" onClick={onOpenInApp}>
                Open in app
              </Button>
            )}
          </>
        }
      />
    );
  }
  const Renderer = RENDERERS[kind];
  return <Renderer key={resource.id} resource={resource} full={full} zoom={zoom} onZoom={onZoom} />;
}
