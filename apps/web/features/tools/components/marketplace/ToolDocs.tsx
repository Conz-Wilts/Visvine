'use client';

/**
 * A Tool's own documentation — the BODY of its `tools/<name>/index.md` at
 * publish time — rendered as prose in the detail drawer.
 *
 * The same react-markdown pipeline the message feed uses (remark-gfm for tables
 * and task lists, rehype-sanitize on the way out), because this text is written
 * by whoever authored the Tool and read by whoever is deciding whether to
 * install it: it is exactly as untrusted as a chat message, and it must not be
 * able to smuggle markup into the app shell. Images are dropped along with every
 * other tag the shared schema refuses.
 *
 * Headings render one step down from their source level. An author's `#` is the
 * top of their own document, not the top of the drawer, and the drawer already
 * has a title.
 */

import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { clsx } from 'clsx';

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== 'img'),
};

// Hoisted: fresh arrays and component maps on every render defeat
// react-markdown's memoization and re-run the whole parse.
const REMARK_PLUGINS: ReactMarkdownOptions['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: ReactMarkdownOptions['rehypePlugins'] = [[rehypeSanitize, sanitizeSchema]];

const COMPONENTS: ReactMarkdownOptions['components'] = {
  h1: ({ children }) => <h3 className="mt-5 text-base font-semibold text-text-primary first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-5 text-sm font-semibold text-text-primary first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-4 text-sm font-semibold text-text-secondary first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="mt-2 text-sm leading-relaxed text-text-secondary first:mt-0">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="ml-5 list-disc text-sm leading-relaxed text-text-secondary">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-surface-3 px-1 py-0.5 font-mono text-[13px] text-text-primary">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-3 p-3 font-mono text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-dark-green underline hover:opacity-80">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-[3px] border-border-default pl-3 text-sm text-text-muted">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-border-subtle py-1.5 pr-4 font-medium text-text-primary">{children}</th>,
  td: ({ children }) => <td className="border-b border-border-subtle py-1.5 pr-4 text-text-secondary">{children}</td>,
  hr: () => <hr className="my-4 border-border-subtle" />,
};

export default function ToolDocs({ source, className }: { source: string; className?: string }) {
  const text = source.trim();
  if (!text) {
    return <p className={clsx('text-sm text-text-muted', className)}>This tool ships no documentation.</p>;
  }
  return (
    <div className={clsx('min-w-0', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
