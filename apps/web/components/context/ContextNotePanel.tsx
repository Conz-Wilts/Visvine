'use client';

// The explorer's right column: the selected note, read. Not an excerpt and not
// an editor — the whole body, rendered and scrollable, so the browser answers
// "what does this actually say" without a route change. Editing stays an
// explicit step — the expand button opens the note for real.
//
// Links inside the body that resolve to another note in scope re-select it in
// place, matching the middle column's link rows; everything else is an
// ordinary external link. The header stays pinned while the body scrolls, so
// the title of what you're reading never leaves the screen.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { Maximize2 } from 'lucide-react';
import { readNote } from '@/features/notes/lib/contextPrefetch';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { NoteMetaRows } from '@/features/notes/components/NoteMetaRows';
import { noteHref } from '@/lib/notes/entities';
import { splitFrontmatter, resolveOkfLink } from '@/lib/notes/shared/markdown';
import { timeAgo } from '@/lib/date';
import type { ContextItem } from '@/hooks/useContextBrowse';

const MD_REMARK_PLUGINS: ReactMarkdownOptions['remarkPlugins'] = [remarkGfm];
const MD_REHYPE_PLUGINS: ReactMarkdownOptions['rehypePlugins'] = [rehypeSanitize];

type Body = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string };

interface ContextNotePanelProps {
  communityId: string;
  /** The selected note, or null for the empty state. */
  item: ContextItem | null;
  /** Every note in scope — decides which body links are internal. */
  items: ContextItem[];
  /** Re-select another note from a link in the body. */
  onSelectPath: (path: string) => void;
  tagColors?: Record<string, string> | null;
}

export default function ContextNotePanel({
  communityId, item, items, onSelectPath, tagColors,
}: ContextNotePanelProps) {
  const { currentCommunity } = useCommunity();
  const nodeTypes = currentCommunity?.nodeTypes;
  const [body, setBody] = useState<Body>({ status: 'loading' });
  const path = item?.path ?? null;

  useEffect(() => {
    if (!path) return;
    setBody({ status: 'loading' });
    let cancelled = false;
    readNote(communityId, path).then((res) => {
      if (cancelled) return;
      if (res.status === 'ok') setBody({ status: 'ready', text: splitFrontmatter(res.content).body.trim() });
      else if (res.status === 'missing') setBody({ status: 'ready', text: '' });
      else setBody({ status: 'error', message: res.message });
    });
    return () => {
      cancelled = true;
    };
  }, [communityId, path]);

  const pathSet = useMemo(() => new Set(items.map((i) => i.path)), [items]);

  // Rebuilt only when the note or the note set changes — a fresh components map
  // per render would defeat react-markdown's memoization on every keystroke in
  // the search box.
  const components = useMemo<ReactMarkdownOptions['components']>(() => {
    const from = path ?? '';
    return {
      a: ({ href, children }) => {
        const target = href && !/^[a-z]+:/i.test(href) ? resolveOkfLink(href, from) : null;
        if (target && pathSet.has(target)) {
          return (
            <button
              type="button"
              onClick={() => onSelectPath(target)}
              className="text-brand-dark-green underline transition-colors hover:text-brand-green"
            >
              {children}
            </button>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-dark-green underline hover:opacity-80">
            {children}
          </a>
        );
      },
      h1: ({ children }) => <h1 className="mt-5 text-lg font-semibold text-text-primary">{children}</h1>,
      h2: ({ children }) => <h2 className="mt-5 text-base font-semibold text-text-primary">{children}</h2>,
      h3: ({ children }) => <h3 className="mt-4 text-sm font-semibold text-text-primary">{children}</h3>,
      p: ({ children }) => <p className="mt-3 leading-relaxed">{children}</p>,
      ul: ({ children }) => <ul className="mt-3 flex list-disc flex-col gap-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="mt-3 flex list-decimal flex-col gap-1 pl-5">{children}</ol>,
      blockquote: ({ children }) => (
        <blockquote className="mt-3 border-l-[3px] border-border-default pl-3 text-text-muted">{children}</blockquote>
      ),
      code: ({ children }) => <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[12px]">{children}</code>,
      pre: ({ children }) => (
        <pre className="mt-3 overflow-x-auto rounded-md bg-surface-3 p-3 font-mono text-[12px]">{children}</pre>
      ),
      hr: () => <hr className="mt-4 border-border-subtle" />,
      table: ({ children }) => (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">{children}</table>
        </div>
      ),
      th: ({ children }) => <th className="border-b border-border-default px-2 py-1 font-semibold">{children}</th>,
      td: ({ children }) => <td className="border-b border-border-subtle px-2 py-1">{children}</td>,
      img: ({ src, alt }) => <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} className="mt-3 max-w-full rounded-md" />,
    };
  }, [path, pathSet, onSelectPath]);

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-text-muted">
        Select a context to read it here.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border-subtle px-5 py-4">
        <div className="flex items-start gap-2">
          <Link
            href={noteHref(item.path)}
            title="Open full note"
            aria-label="Open full note"
            className="mt-0.5 shrink-0 rounded-md border border-border-subtle p-1.5 text-text-muted transition-colors hover:text-brand-green"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Link>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-primary">{item.title}</h2>
            <div className="text-[12px] text-text-muted">Updated {timeAgo(item.mtime, { style: 'long' })}</div>
          </div>
        </div>

        <NoteMetaRows
          className="mt-3"
          type={item.type}
          tags={item.tags}
          nodeTypes={nodeTypes}
          tagColors={tagColors}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm text-text-secondary">
        {body.status === 'loading' ? (
          <p className="text-text-muted">Loading…</p>
        ) : body.status === 'error' ? (
          <p className="text-red-500">{body.message}</p>
        ) : body.text ? (
          <ReactMarkdown
            remarkPlugins={MD_REMARK_PLUGINS}
            rehypePlugins={MD_REHYPE_PLUGINS}
            components={components}
          >
            {body.text}
          </ReactMarkdown>
        ) : (
          <p className="italic text-text-muted">This note is empty.</p>
        )}
      </div>
    </div>
  );
}
