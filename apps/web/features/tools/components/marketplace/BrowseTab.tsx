'use client';

/**
 * Browse — the shared shelf. Every approved Tool in the registry, newest
 * publication first, whoever published it.
 *
 * Global on purpose: a Tool published by another space is exactly what somebody
 * is here to find, and the catalogue is the one part of Tools that isn't
 * space-scoped. What IS space-scoped is the "Installed" badge, which only
 * appears when the browse call could name a space — the flag is absent rather
 * than false otherwise, so a card never claims "not installed" when nobody asked.
 *
 * Search runs server-side over title, name and description, debounced so a
 * typed word is one request rather than six.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { BlocksIcon, DownloadIcon } from '@/features/shared/icons';
import { Chip, EmptyState, SearchInput, Skeleton } from '@/components/ui';
import Button from '@/components/ui/Button';
import PerimeterSummary from '@/features/tools/components/PerimeterSummary';
import { browseTools } from '@/features/tools/lib/client';
import type { BrowseItem } from '@/lib/tools/api';

/** Long enough that typing a word is one request, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 250;

export default function BrowseTab({
  spaceId,
  onOpen,
  onError,
  /** Bumped by the shell after an install, so the badges catch up. */
  reloadKey,
}: {
  spaceId: string | null;
  onOpen: (item: BrowseItem) => void;
  onError: (message: string) => void;
  reloadKey: number;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<BrowseItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Ref rather than state: it only ever guards a stale response, and putting it
  // in state would re-run the effect that sets it.
  const latest = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const run = ++latest.current;
    setItems(null);
    browseTools({ q: debounced, spaceId, signal: controller.signal })
      .then((body) => {
        if (run !== latest.current) return;
        setItems(body.versions);
        setCursor(body.nextCursor);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || run !== latest.current) return;
        setItems([]);
        onError(err instanceof Error ? err.message : 'Could not load the marketplace.');
      });
    return () => controller.abort();
  }, [debounced, spaceId, reloadKey, onError]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const body = await browseTools({ q: debounced, spaceId, cursor });
      setItems((current) => [...(current ?? []), ...body.versions]);
      setCursor(body.nextCursor);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not load more tools.');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, debounced, spaceId, onError]);

  return (
    <div className="space-y-5">
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search tools by name or description…"
        className="max-w-md"
      />

      {items === null ? (
        <CardGridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BlocksIcon className="h-6 w-6" />}
          // `EmptyState` shows the description and keeps the title only as its
          // fallback, so each line has to stand on its own.
          title="Nothing to show"
          description={
            debounced
              ? `Nothing in the marketplace matches “${debounced}”. Try a shorter search, or clear it to see everything published.`
              : 'The marketplace is empty — no tool has been approved yet. Build one over MCP and publish it; see the Mine tab.'
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <ToolCard key={item.id} item={item} onOpen={() => onOpen(item)} />
            ))}
          </div>
          {cursor && (
            <div className="flex justify-center pt-2">
              <Button variant="ghost" onClick={loadMore} loading={loadingMore} loadingText="Loading…">
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One entry. The whole thing is the button — an entry with a "View" link in
 *  it reads as two targets for one destination. No box: the grid gap and the
 *  hover tint are what separate one from the next. */
function ToolCard({ item, onOpen }: { item: BrowseItem; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full flex-col rounded-lg p-4 text-left transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{item.title}</p>
          <p className="truncate font-mono text-[11px] text-text-muted">
            {item.name} · v{item.version}
          </p>
        </div>
        {item.installedInSpace && (
          <Chip tone="solid" size="sm" color="#16a34a">
            Installed
          </Chip>
        )}
      </div>

      <p className="mt-2 line-clamp-2 min-h-[2.5rem] text-sm text-text-secondary">
        {item.description || 'No description.'}
      </p>

      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <Chip key={tag} tone="solid" size="sm">
              {tag}
            </Chip>
          ))}
        </div>
      )}

      {item.releaseNotes && (
        <p className="mt-2 line-clamp-2 text-xs text-text-muted">
          <span className="font-medium text-text-secondary">v{item.version}:</span> {item.releaseNotes}
        </p>
      )}

      <PerimeterSummary perimeter={item.perimeter} className="mt-3" />

      <div className="mt-auto flex items-center gap-3 pt-3 text-xs text-text-muted">
        <span className="truncate">{item.author.name ?? 'Unknown author'}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <DownloadIcon className="h-3.5 w-3.5" aria-hidden />
          {item.installs} {item.installs === 1 ? 'space' : 'spaces'}
        </span>
      </div>
    </button>
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="p-4">
          <Skeleton className="h-4 w-1/2 rounded" />
          <Skeleton className="mt-2 h-3 w-1/3 rounded" />
          <Skeleton className="mt-3 h-3 w-full rounded" />
          <Skeleton className="mt-1.5 h-3 w-4/5 rounded" />
          <Skeleton className="mt-4 h-3 w-2/3 rounded" />
        </div>
      ))}
    </div>
  );
}
