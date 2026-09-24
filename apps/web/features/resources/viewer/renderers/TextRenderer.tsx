'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@visvine/ui';
import { MarkdownMessage } from '@/features/messages/components/MessageRow';
import type { RendererProps } from './types';

/**
 * A text file as its text: Markdown rendered (sanitised, as a message is),
 * anything else — code, logs, HTML, SVG — as its source, with line numbers.
 * Markup is never rendered as a document (lib/resources/shared/uploadPolicy.ts).
 */
export default function TextRenderer({ resource }: RendererProps) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const markdown = /\.(md|markdown)$/i.test(resource.name);

  useEffect(() => {
    if (!resource.rawUrl) return;
    let cancelled = false;
    fetch(resource.rawUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((body) => !cancelled && setText(body))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [resource.rawUrl]);

  if (failed) return null;
  if (text === null) {
    return (
      <div className="space-y-2 p-8">
        {[92, 80, 86, 60, 74].map((w) => (
          <Skeleton key={w} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  }
  if (markdown) {
    return (
      <div className="h-full overflow-auto bg-surface">
        <article className="mx-auto max-w-2xl px-8 py-8 text-[15px] leading-relaxed text-fg [&_a]:underline [&_h1]:mb-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2">
          <MarkdownMessage text={text} />
        </article>
      </div>
    );
  }
  const lines = text.split('\n');
  return (
    <div className="h-full overflow-auto bg-surface">
      <pre className="min-w-fit p-4 font-mono text-[13px] leading-6 text-fg">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-12 shrink-0 select-none pr-4 text-right tabular-nums text-fg-subtle">{i + 1}</span>
            <span className="whitespace-pre">{line || ' '}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
