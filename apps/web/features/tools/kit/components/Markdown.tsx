/**
 * `Markdown` — render a note body (or any markdown) safely inside a Tool.
 *
 * The same pipeline the app uses for Tool docs and the message feed:
 * react-markdown → remark-gfm (tables, task lists, strikethrough) →
 * rehype-sanitize on the way out. The schema is the library default minus
 * anything that fetches (`img`, `picture`, `source`) and with `href` limited to
 * http/https — the frame has no network and no cookies, but a note body is
 * user content and the sanitizer is what makes rendering it a non-event.
 *
 * Links: an in-app path (`/directory/…`) asks Visvine to navigate, because the
 * sandbox lets the frame go nowhere else; an external URL is rendered as a
 * link but the sandbox has no `allow-popups`, so pass `onLinkClick` to do
 * something useful with it (copy it, show it) if your Tool needs to.
 */
import ReactMarkdown, { type Options as ReactMarkdownOptions } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { useMemo } from 'react';
import { useVisvineMaybe } from '../hooks';
import { cx } from './cx';

const REMOVED_TAGS = new Set(['img', 'picture', 'source', 'input']);

const SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => !REMOVED_TAGS.has(tag)),
  protocols: { ...defaultSchema.protocols, href: ['http', 'https'] },
};

// Hoisted: fresh arrays defeat react-markdown's memoisation and re-run the parse.
const REMARK_PLUGINS: ReactMarkdownOptions['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: ReactMarkdownOptions['rehypePlugins'] = [[rehypeSanitize, SCHEMA]];

export interface MarkdownProps {
  /** The markdown source — a note's `content`, typically. */
  source: string;
  className?: string;
  /**
   * Called for every link click with the raw href. Return `false` to also let
   * the default happen. Defaults to: in-app paths navigate, others do nothing.
   */
  onLinkClick?: (href: string) => void | boolean;
}

function isInAppPath(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

export function Markdown({ source, className, onLinkClick }: MarkdownProps) {
  const visvine = useVisvineMaybe();

  const components = useMemo<ReactMarkdownOptions['components']>(
    () => ({
      a: ({ href, children }) => {
        const target = href ?? '';
        return (
          <a
            href={target || undefined}
            className="vv-md__link"
            onClick={(e) => {
              if (onLinkClick) {
                if (onLinkClick(target) === false) return;
                e.preventDefault();
                return;
              }
              e.preventDefault();
              if (isInAppPath(target)) visvine?.navigate(target);
            }}
          >
            {children}
          </a>
        );
      },
      table: ({ children }) => (
        <div className="vv-md__table-wrap">
          <table className="vv-table">{children}</table>
        </div>
      ),
    }),
    [onLinkClick, visvine],
  );

  const text = source.trim();
  if (!text) return null;
  return (
    <div className={cx('vv-md', className)}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
