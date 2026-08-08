'use client';

// The Context tool: the community's knowledge, browsable.
//
// A toolbar across the top — search and the facets scope the whole surface —
// and under it three columns, each answering one question about the selection:
//
//   1. Where is it — the folder tree, the same one the docked sidebar shows,
//      leveled up: virtualized, searchable in place (matches keep their
//      ancestor chain and light up where they live, instead of being ripped
//      into a flat result list), rows kept bare so the hierarchy reads —
//      tags, links and freshness belong to the columns beside it.
//   2. What does it say — the note body, rendered and scrollable.
//   3. What does it touch — every connection, grouped by the type of note on
//      the other end, direction marked per row, all of them clickable.
//
// Selecting never navigates: clicking through a chain of notes moves all three
// columns and stays on the page. Opening a note for real is an explicit step
// (double click, Cmd+Enter, or the expand button in the third column).
//
// Mounted by the Directory's Context tab and by /context, so it fills whatever
// height its host gives it (h-full) rather than measuring the viewport itself.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCommunity } from '@/lib/contexts/CommunityContext';
import { isFeatureEnabled } from '@/lib/featureAccess';
import { useContextBrowse, type ContextBrowseInitial, type ContextItem } from '@/hooks/useContextBrowse';
import { useContextTree } from '@/features/notes/lib/useContextTree';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { SharePanel } from '@/features/notes/components/SharePanel';
import ContextFilterBar from './ContextFilterBar';
import ContextTreeExplorer from './ContextTreeExplorer';
import ContextLinksPanel from './ContextLinksPanel';
import ContextNotePanel from './ContextNotePanel';
import { ancestorClosure } from './contextTreeModel';
import { humanizeFolderName, isIndexPath } from '@/lib/notes/shared/indexNote';
import type { ContextTreeRowHandlers } from './ContextTreeRow';
import { prefetchNoteContext } from '@/features/notes/lib/contextPrefetch';
import { noteHref, parseEntityHref } from '@/lib/notes/entities';
import type { CommunityFeatureConfig } from '@/lib/types';

const URL_DEBOUNCE_MS = 300;

/**
 * Display title for a link target, which may be outside the filtered set.
 *
 * Index notes are folded into their folder everywhere else and are filtered out
 * of `items` entirely, so they're looked up in `titleByPath` — every note the
 * brain holds, including the indexes. That title IS the folder's name, so a link
 * to `communities/index.md` reads "Companies", the same as its tree row.
 */
function titleOfPath(path: string, items: ContextItem[], titleByPath: Map<string, string>): string {
  const known = items.find((i) => i.path === path)?.title ?? titleByPath.get(path);
  if (known) return known;
  if (isIndexPath(path)) {
    const folder = path.split('/').slice(-2, -1)[0];
    return folder ? humanizeFolderName(folder) : 'Index';
  }
  return humanizeFolderName((path.split('/').pop() ?? path).replace(/\.md$/, ''));
}

/** The filter state a shared URL restores, read once on mount. */
function readInitialFromParams(params: URLSearchParams): ContextBrowseInitial {
  const csv = (key: string) => params.get(key)?.split(',').filter(Boolean);
  return {
    searchTerm: params.get('q') ?? undefined,
    filterTags: csv('tags'),
    filterTypes: csv('types'),
    starredOnly: params.get('starred') === '1',
    connectedTo: params.get('connected'),
    selectedPath: params.get('sel'),
  };
}

export default function ContextBrowser() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentCommunity } = useCommunity();
  const communityId = currentCommunity?.id ?? null;
  const featureConfig = (currentCommunity?.featureConfig as CommunityFeatureConfig | undefined) ?? null;
  const notesEnabled = isFeatureEnabled(featureConfig, 'notes');
  const tagColors = currentCommunity?.designConfig?.tagColors ?? null;

  const { entityByPath } = useDirectoryEntities();
  const ctx = useContextTree({ communityId, enabled: notesEnabled });
  // Hydrated once from the URL so a copied link restores the exact view;
  // afterwards the state owns itself and the URL trails it (below).
  const [initial] = useState(() => readInitialFromParams(new URLSearchParams(searchParams)));
  const browse = useContextBrowse(ctx.notes, communityId, { starred: ctx.starred, initial });
  const { selectedPath, setSelectedPath } = browse;

  // Reflect the browse state back into the query string — debounced
  // replace-not-push so typing neither floods history nor re-renders the page
  // tree, and skipped on first paint (the URL already says what we hydrated).
  const firstUrlWrite = useRef(true);
  useEffect(() => {
    if (firstUrlWrite.current) {
      firstUrlWrite.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const setOrDelete = (key: string, value: string | null) => {
        if (value) params.set(key, value);
        else params.delete(key);
      };
      setOrDelete('q', browse.searchTerm.trim() || null);
      setOrDelete('tags', [...browse.filterTags].join(',') || null);
      setOrDelete('types', [...browse.filterTypes].join(',') || null);
      setOrDelete('starred', browse.starredOnly ? '1' : null);
      setOrDelete('connected', browse.connectedTo);
      setOrDelete('sel', selectedPath);
      const query = params.toString();
      router.replace(`${window.location.pathname}${query ? `?${query}` : ''}`, { scroll: false });
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    router, browse.searchTerm, browse.filterTags, browse.filterTypes,
    browse.starredOnly, browse.connectedTo, selectedPath,
  ]);

  const selectedItem = useMemo(
    () => browse.items.find((i) => i.path === selectedPath) ?? null,
    [browse.items, selectedPath],
  );

  // Owned here so the links column and the note body agree on what a path is
  // called, and neither rebuilds the lookup on its own. Built from ctx.notes,
  // not browse.items: the latter drops index notes, which are exactly the ones
  // whose titles name their folders.
  const titleByPath = useMemo(
    () => new Map(ctx.notes.map((n) => [n.path, n.title])),
    [ctx.notes],
  );
  const titleFor = useMemo(
    () => (target: string) => titleOfPath(target, browse.items, titleByPath),
    [browse.items, titleByPath],
  );

  // The prune sets. When a search or filter is active, the tree keeps only the
  // surviving notes plus every folder on the way down to them; a search also
  // lights the survivors up as matches.
  const filterActive = browse.activeCount > 0 || !!browse.searchTerm.trim() || !!browse.folder;
  const keep = useMemo(() => {
    if (!filterActive) return null;
    const paths = browse.filteredItems.map((i) => i.path);
    const set = ancestorClosure(paths);
    for (const p of paths) set.add(p);
    return set;
  }, [filterActive, browse.filteredItems]);
  const matched = useMemo(() => {
    if (!browse.searchTerm.trim()) return null;
    return new Set(browse.filteredItems.map((i) => i.path));
  }, [browse.searchTerm, browse.filteredItems]);

  // Opening for real: entity notes go to their profile's Context tab, plain
  // notes to the standalone note view. Same rule the docked tree follows.
  const openPath = useCallback(
    (path: string) => {
      const href = parseEntityHref(path);
      const entity = entityByPath.get(path) ?? (href ? entityByPath.get(href) : undefined);
      if (communityId) prefetchNoteContext(communityId, path);
      if (entity) router.push(`/directory/${encodeURIComponent(entity.id)}?tab=context`);
      else router.push(noteHref(path));
    },
    [communityId, entityByPath, router],
  );

  const treeHandlers = useMemo<ContextTreeRowHandlers>(
    () => ({
      // The explorer's own tree-state hook overrides this; the row never sees it.
      onToggleFolder: () => {},
      onSelectNote: setSelectedPath,
      onOpenNote: openPath,
      onToggleStar: ctx.handleToggleStar,
      onDeleteNote: ctx.handleDeleteNote,
      onShareNote: (path) => ctx.setShareTarget({ path, kind: 'note' }),
      onFolderAccess:
        communityId && !communityId.startsWith('me:')
          ? (path) => ctx.setShareTarget({ path, kind: 'folder' })
          : undefined,
      onDeleteFolder: ctx.handleDeleteFolder,
      onRestoreTrash: ctx.handleRestoreTrash,
      onPurgeTrash: ctx.handlePurgeTrash,
      onEmptyTrash: ctx.handleEmptyTrash,
    }),
    [communityId, ctx, setSelectedPath, openPath],
  );

  if (!notesEnabled || !communityId) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-text-muted">
        Context is not enabled for this community.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" data-tour="context-canvas">
      {/* The toolbar spans all three columns: search and the facets narrow the
          whole surface, not just the tree — what survives them is what the
          other two columns can reach. */}
      <ContextFilterBar browse={browse} tagColors={tagColors} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Column 1 — the selector: the virtualized tree. */}
        <section className="flex min-w-0 flex-1 basis-0 flex-col overflow-hidden">
          {ctx.error ? (
            <div className="px-6 py-6 text-sm text-red-500">{ctx.error}</div>
          ) : (
            <ContextTreeExplorer
              communityId={communityId}
              rootLabel={ctx.rootFolder.label}
              tree={ctx.tree}
              items={browse.items}
              starred={ctx.starred}
              trash={ctx.trash}
              folderBadges={ctx.folderBadges}
              loading={ctx.loading && ctx.notes.length === 0}
              keep={keep}
              matched={matched}
              searchQuery={browse.searchTerm.trim()}
              selectedPath={selectedPath}
              canEdit
              handlers={treeHandlers}
            />
          )}
        </section>

        {/* Column 2 — the note itself, scrolling under a pinned header. The
            middle seat: it's what you came to read, so it sits next to the tree
            you picked it from. Kept down to 1024px, where the two still fit. */}
        <aside className="hidden min-h-0 min-w-0 flex-1 basis-0 border-l border-border-subtle bg-surface-1 lg:block">
          <ContextNotePanel
            communityId={communityId}
            item={selectedItem}
            items={browse.items}
            onSelectPath={setSelectedPath}
            tagColors={tagColors}
          />
        </aside>

        {/* Column 3 — the links: what the selection connects to, grouped by
            what the other end is. An equal third, like its neighbours. First to
            go when the window narrows (below 1280px): the tree and the note
            body are the load-bearing pair. */}
        <aside className="hidden min-h-0 flex-1 basis-0 border-l border-border-subtle bg-surface-1 xl:block">
          <ContextLinksPanel
            item={selectedItem}
            items={browse.items}
            titleFor={titleFor}
            keep={keep}
            onSelectPath={setSelectedPath}
          />
        </aside>
      </div>

      {ctx.shareTarget !== null && (
        <SharePanel
          communityId={communityId}
          path={ctx.shareTarget.path}
          kind={ctx.shareTarget.kind}
          onClose={() => ctx.setShareTarget(null)}
        />
      )}
    </div>
  );
}
