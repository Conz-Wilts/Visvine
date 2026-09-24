'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { Skeleton } from '@visvine/ui';
import type { RendererProps } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

/** Pages drawn at once past the ones on screen; the rest draw as they scroll in. */
const OVERSCAN = 2;

/**
 * A PDF drawn by pdf.js: its pages at the stage's width times the zoom, with
 * a selectable text layer (so the browser's find and copy work), and in full
 * screen a rail of page thumbnails that scrolls the document. Pages outside
 * the view are placeholders until they come near it.
 */
export default function PdfRenderer({ resource, full, zoom }: RendererProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pages, setPages] = useState(0);
  const [near, setNear] = useState<Set<number>>(new Set([1, 2, 3]));
  const [current, setCurrent] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width - 48)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el || !pages) return;
    const observer = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const n = Number((entry.target as HTMLElement).dataset.page);
            if (entry.isIntersecting) for (let i = n - OVERSCAN; i <= n + OVERSCAN; i++) if (i >= 1 && i <= pages) next.add(i);
          }
          return next;
        });
        const visible = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page));
        if (visible.length) setCurrent(Math.min(...visible));
      },
      { root: el, rootMargin: '200px 0px' },
    );
    el.querySelectorAll('[data-page]').forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [pages]);

  if (!resource.rawUrl) return null;
  const pageWidth = Math.round(Math.min(width, 880) * zoom.scale);
  const goTo = (n: number) => stage.current?.querySelector(`[data-page="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <Document
      file={resource.rawUrl}
      onLoadSuccess={({ numPages }) => setPages(numPages)}
      onLoadError={() => setFailed(true)}
      loading={<PdfSkeleton />}
      error={<PdfSkeleton />}
      className="flex h-full"
    >
      {full && pages > 1 && (
        <nav aria-label="Pages" className="hidden w-40 shrink-0 overflow-y-auto border-r border-line-subtle bg-surface p-3 lg:block">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => goTo(n)}
              className="mb-3 block w-full text-center"
              aria-current={n === current ? 'page' : undefined}
            >
              <span className={`block overflow-hidden rounded-md border ${n === current ? 'border-accent' : 'border-line-subtle'}`}>
                {near.has(n) || n <= 8 ? (
                  <Page pageNumber={n} width={112} renderTextLayer={false} renderAnnotationLayer={false} />
                ) : (
                  <span className="block aspect-[3/4] bg-surface-subtle" />
                )}
              </span>
              <span className="mt-1 block text-xs tabular-nums text-fg-muted">{n}</span>
            </button>
          ))}
        </nav>
      )}
      <div ref={stage} className="min-w-0 flex-1 overflow-auto px-6 py-6">
        {failed && <PdfSkeleton />}
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <div key={n} data-page={n} className="mx-auto mb-4 w-fit bg-surface shadow-float">
            {near.has(n) && pageWidth > 0 ? (
              <Page pageNumber={n} width={pageWidth} loading={<div style={{ width: pageWidth, height: pageWidth * 1.3 }} />} />
            ) : (
              <div style={{ width: pageWidth || 600, height: (pageWidth || 600) * 1.3 }} />
            )}
          </div>
        ))}
      </div>
    </Document>
  );
}

function PdfSkeleton() {
  return (
    <div className="mx-auto mt-6 w-full max-w-2xl space-y-3 px-6">
      <Skeleton className="aspect-[3/4] w-full rounded-md bg-surface" />
    </div>
  );
}
