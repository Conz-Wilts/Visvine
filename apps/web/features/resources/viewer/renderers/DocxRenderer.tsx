'use client';

import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@visvine/ui';
import type { RendererProps } from './types';

/**
 * A Word document drawn by docx-preview into a sandboxed frame: the frame
 * runs no script (sandbox without allow-scripts), keeps the document's own
 * styles off the app, and every link in it is made inert — a document can
 * carry `javascript:` hyperlinks, and those never get a chance to run.
 */
export default function DocxRenderer({ resource }: RendererProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    const doc = frame.current?.contentDocument;
    if (!doc || !resource.rawUrl) return;
    (async () => {
      try {
        const [{ renderAsync }, res] = await Promise.all([import('docx-preview'), fetch(resource.rawUrl!)]);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        doc.open();
        doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
        doc.close();
        doc.body.style.margin = '0';
        doc.body.style.background = 'transparent';
        await renderAsync(blob, doc.body, doc.head, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          useBase64URL: true,
        });
        for (const a of Array.from(doc.querySelectorAll('a'))) {
          a.removeAttribute('href');
          a.removeAttribute('target');
        }
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resource.rawUrl]);

  return (
    <div className="relative h-full w-full">
      {state === 'loading' && (
        <div className="absolute inset-0 mx-auto max-w-2xl p-6">
          <Skeleton className="aspect-[3/4] w-full rounded-md bg-surface" />
        </div>
      )}
      <iframe
        ref={frame}
        title={resource.name}
        sandbox="allow-same-origin"
        className={`h-full w-full border-0 ${state === 'ready' ? '' : 'invisible'}`}
      />
      {state === 'failed' && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-fg-muted">{resource.name}</p>}
    </div>
  );
}
