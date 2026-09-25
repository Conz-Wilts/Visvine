'use client';

import { useEffect, useState } from 'react';
import { Alert, EmptyState, Skeleton } from '@visvine/ui';
import { swrFetch } from '@/features/shared/lib/requestCache';
import ToolIcon from '@/features/tools/components/toolIcons';
import ListingAboutSheet from '@/features/tools/components/ListingAboutSheet';
import { fetchDirectory } from '@/features/tools/lib/client';
import type { ListingCard } from '@/lib/tools/directory';

const GRID_STYLE: React.CSSProperties = {
  display: 'grid',
  gap: '20px',
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
};

/** The directory's cache key for a search — the same one the tab's probe reads for none. */
export const directoryKey = (q: string) => `tools:directory:${q.trim().toLowerCase()}`;

/**
 * Discover → Tools: every Tool Visvine lists, most installed first. A card
 * opens the Tool's About, and an admin installs it into a space they run
 * from there. Search arrives from the toolbar.
 */
export default function ToolsView({ search }: { search: string }) {
  const [q, setQ] = useState(search);
  const [items, setItems] = useState<ListingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A beat after the last keystroke, so a search is one read, not one per letter.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let live = true;
    swrFetch(directoryKey(q), () => fetchDirectory(q), (page) => {
      if (live) setItems(page.items);
    }).catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Could not load tools'));
    return () => {
      live = false;
    };
  }, [q]);

  if (error) return <Alert>{error}</Alert>;
  if (!items) {
    return (
      <div style={GRID_STYLE}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <>
      {notice && (
        <div className="mb-5">
          <Alert variant="success" onDismiss={() => setNotice(null)}>
            {notice}
          </Alert>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title={q ? `No tools match “${q}”` : 'No tools listed yet'} />
      ) : (
        <div style={GRID_STYLE}>
          {items.map((card) => (
            <button
              key={card.listingId}
              type="button"
              onClick={() => setOpen(card.listingId)}
              className="flex flex-col gap-2 rounded-xl border border-line-subtle p-4 text-left transition-colors hover:bg-surface-subtle"
            >
              <span className="flex items-center gap-2.5">
                <span className="shrink-0 text-fg-secondary">
                  <ToolIcon name={card.rail?.icon} svg={card.iconSvg} />
                </span>
                <span className="min-w-0 truncate text-base font-semibold text-fg">{card.title}</span>
              </span>
              <span className="truncate text-xs text-fg-muted">
                {[card.publisher.name, card.verified ? 'verified' : null, `${card.installs} ${card.installs === 1 ? 'space' : 'spaces'}`]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              {card.description && <span className="line-clamp-2 text-sm text-fg-secondary">{card.description}</span>}
            </button>
          ))}
        </div>
      )}
      {open && (
        <ListingAboutSheet
          listingId={open}
          onClose={() => setOpen(null)}
          onInstalled={(message) => {
            setOpen(null);
            setNotice(message);
          }}
        />
      )}
    </>
  );
}
