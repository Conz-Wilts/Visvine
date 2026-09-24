'use client';

import { useEffect, useState } from 'react';
import type { RendererProps } from './types';

interface Outline {
  text: string;
}

/**
 * A deck, without a converter: the picture it carries of its first slide and
 * the text of every slide in order. The deck itself opens in its own app.
 */
export default function SlidesRenderer({ resource }: RendererProps) {
  const [outline, setOutline] = useState<string[] | null>(null);

  useEffect(() => {
    if (!resource.hasText) return;
    let cancelled = false;
    fetch(`/api/resources/${encodeURIComponent(resource.id)}/text`)
      .then((res) => (res.ok ? (res.json() as Promise<Outline>) : Promise.reject()))
      .then(({ text }) => {
        if (cancelled) return;
        setOutline(
          text
            .split(/\n(?=## Slide \d+)/)
            .map((block) => block.replace(/^## Slide \d+\s*/, '').trim())
            .filter(Boolean),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [resource.id, resource.hasText]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {resource.page1Url && (
          <img src={resource.page1Url} alt="" className="mx-auto w-full rounded-lg bg-surface shadow-float" />
        )}
        {outline && outline.length > 0 && (
          <ol className="divide-y divide-line-subtle rounded-xl bg-surface">
            {outline.map((slide, i) => (
              <li key={i} className="flex gap-4 px-4 py-3">
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-fg-muted">{i + 1}</span>
                <p className="text-sm leading-relaxed text-fg-secondary">{slide}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
