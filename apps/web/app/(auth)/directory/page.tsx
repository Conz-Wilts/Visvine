'use client';

import React, { Suspense, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import NodeGrid from '@/features/directory/components/NodeGrid';
import DirectoryToolbar from '@/features/directory/components/DirectoryToolbar';
import DirectoryTableView from '@/features/directory/components/table/DirectoryTableView';
import ContentReveal from '@/components/ui/ContentReveal';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useViewportPane } from '@/app/(auth)/AuthLayoutClient';
import { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import {
  contextKeys,
  peekContextCache,
  prefetchNoteContext,
  usePrefetchContextRoot,
} from '@/features/notes/lib/contextPrefetch';
import { ensureRootIndexNote, ROOT_INDEX_PATH } from '@/features/notes/lib/rootIndex';
import { resetContextTreeState } from '@/features/notes/hooks/useContextTreeState';
import { noteHref } from '@/lib/notes/entities';
import {
  directoryTabs,
  directoryViewHref,
  isDirectoryView,
  RESOURCES_HREF,
  type DirectoryView,
} from '@/lib/directory/views';
import type { NoteMeta } from '@/lib/notes/shared/types';
import type { SpaceAlias } from '@/lib/types';

/** The tab set and the hrefs behind it are shared with the note route. */
const DIRECTORY_TABS: PaneTabItem[] = directoryTabs();

/**
 * The Directory: a searchable, filterable card grid of everyone and everything
 * (Grid), the same entries as rows with a column per thing their type tracks
 * (Table, `?view=table&type=<type>`). The Context tab
 * in the pane bar isn't a view of this page — it navigates to the context's
 * top-level index note (`index.md`, the space's home page). The bar itself
 * lives in the persistent pane shell (directory/layout.tsx) — this page just
 * registers its tabs.
 */
export default function DashboardPage() {
  // useSearchParams needs a Suspense boundary above it.
  return (
    <Suspense fallback={null}>
      <DirectoryPane />
    </Suspense>
  );
}

function DirectoryPane() {
  const router = useSpaceRouter();
  const { currentSpace, loading: spaceLoading } = useSpace();
  const noSpace = !spaceLoading && !currentSpace;
  const spaceId = currentSpace?.id ?? null;
  const spaceName = currentSpace?.name ?? '';
  const { releaseDockNow } = useContextPanel();

  // Context navigates to the context's root index note. New contexts are seeded with
  // one at create time and the create dialog waits for it; an older context that
  // never got one has it written here on first open — the note page's missing
  // state is an access-request card, which is the wrong surface for "this note
  // was never written". ensureRootIndexNote is the shared version of that.
  //
  // Waiting for that check before navigating is what made the tab feel slow:
  // it is a round trip (two, cold) in front of a route change that needs
  // neither. So the wait happens only when the answer isn't already in hand —
  // the page prefetches the note list on mount, and a list that already shows
  // the note means there is nothing to ensure and the push can go now.
  const openContext = useCallback(() => {
    if (!spaceId) return;
    prefetchNoteContext(spaceId, ROOT_INDEX_PATH);
    const cached = peekContextCache<{ notes: NoteMeta[] }>(contextKeys.list(spaceId));
    if (cached?.notes.some((n) => n.path === ROOT_INDEX_PATH)) {
      router.push(noteHref(ROOT_INDEX_PATH));
      return;
    }
    void ensureRootIndexNote(spaceId, spaceName).then(() => router.push(noteHref(ROOT_INDEX_PATH)));
  }, [spaceId, spaceName, router]);

  // The view is the URL, so a tab survives reload and a link can name it.
  // ?view=context has no standalone browser behind it: such links land on the
  // grid and hop straight to the index note.
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: DirectoryView = viewParam === 'table' ? viewParam : 'grid';
  const typeParam = searchParams.get('type');
  const wantsContext = viewParam === 'context';
  const redirected = useRef(false);
  useEffect(() => {
    if (!wantsContext || redirected.current || !spaceId) return;
    redirected.current = true;
    openContext();
  }, [wantsContext, spaceId, openContext]);

  // ?view=resources is the resources table.
  useEffect(() => {
    if (viewParam === 'resources') router.replace(RESOURCES_HREF);
  }, [viewParam, router]);

  // Selecting Grid closes any docked tree now, skipping the release grace:
  // the grace exists for navigations where another surface re-claims the dock,
  // but Grid is a terminal state — waiting just holds the closing panel over
  // cards that are already animating in. The dock is NOT released for Context —
  // the note page re-claims it, and the release grace bridges the swap.
  //
  // The type carries across the switch: leaving the Events table for the grid
  // and coming back lands on the events table again, rather than on whichever
  // type happens to sort first.
  const handleSelect = useCallback(
    (id: string) => {
      if (isDirectoryView(id)) {
        releaseDockNow();
        router.replace(directoryViewHref(id, typeParam));
        return;
      }
      openContext();
    },
    [releaseDockNow, openContext, router, typeParam],
  );
  usePaneChrome({
    tabs: noSpace ? null : DIRECTORY_TABS,
    activeId: view,
    onSelect: handleSelect,
    attachedOpen: false,
    ariaLabel: 'Directory views',
    surface: null,
  });

  // Context is one click from every Directory view, and its first paint pulls
  // three code-split chunks and four reads. Start them now, on idle, so the
  // click is a route change over a warm cache.
  usePrefetchContextRoot(spaceId, !noSpace);

  // Standing on the grid (or the table) is leaving Context, so
  // the tree's expansion is forgotten here: entering Context always opens at
  // the space root with one layer under it, never on the chain that happened to
  // be open last time.
  useEffect(() => {
    if (!wantsContext) resetContextTreeState();
  }, [wantsContext]);

  // The Table sizes itself to the viewport and scrolls inside itself, so
  // <main> keeps no scrollbar gutter for it and the grid reaches the screen's
  // right edge. The grid scrolls <main> and keeps its.
  useViewportPane(view === 'table');

  const browse = useDirectoryBrowse();
  const { space, loading, error, filteredItems, handleItemClick } = browse;

  // The table's type rides the URL beside the view, so a link can name
  // "the events table" and a reload lands back on it.
  const handleTypeChange = useCallback(
    (type: string) => router.replace(directoryViewHref('table', type)),
    [router],
  );

  // No space selected (zero memberships): the sidebar rail is already empty,
  // so the directory chrome — tab bar, toolbar, grid — hides too. The centre
  // stays blank on purpose; Discover is reachable from the space switcher, so
  // no prompt sits in the middle of the app. Nothing is
  // rendered at all — a min-height filler here would overflow <main>'s own
  // padded height and leave a scrollbar on an empty page.
  if (noSpace) return null;

  if (view === 'table') {
    return (
      // A fixed height, not a minimum: the table is its own scroll box and has
      // to know where the pane ends (DirectoryTableView). It ends at the
      // VIEWPORT, not at <main>'s padding: the shell's 64px band and 24px of
      // top pad (the tab set rides the band, taking no flow space), with
      // `-mb-6` eating <main>'s pb-6 so the last row sits on the bottom edge
      // rather than 24px above it.
      <div className="relative -mb-6 w-full" style={{ height: 'calc(100dvh - 88px)' }}>
        {/* The reveal is the panel, not the box around it: the sizing above is
            what the table measures its scroll box against, and a wrapper that
            animates a transform must not be that element. */}
        <ContentReveal ready={!loading} id="panel-table" role="tabpanel" className="h-full">
          <DirectoryTableView browse={browse} type={typeParam} onTypeChange={handleTypeChange} />
        </ContentReveal>
      </div>
    );
  }

  return (
    // The surface fills the pane exactly, so a short grid has nothing to
    // scroll: the shell's 64px band and <main>'s 48px of padding — the tab
    // set rides the band and takes no flow space.
    <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 112px)' }}>
      {/* Search, filters, sort and count ride one sticky toolbar welded under
          the pane tab bar; the cards scroll beneath it. It sits OUTSIDE the
          reveal: it is pane chrome, not the view. Rising it would translate the
          sticky bar off its pinned line for the length of the entrance, and the
          cards already scrolled under it would show through the gap it left. */}
      <DirectoryToolbar browse={browse} />

      <ContentReveal ready={!loading} id="panel-grid" role="tabpanel">
        {/* pt-7, not pt-4: a hovered card lifts 6px and throws a soft glow about
            14px past its own edge, and the toolbar it scrolls under is opaque —
            with less clearance the top row's raised shadow was sliced off by the
            toolbar's bottom edge. */}
        <div className="w-full px-6 pt-7 pb-8">
          <div className="flex flex-col gap-5">
            {error && (
              <div className="border-l-2 border-red-500 pl-3 py-1 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* No per-card cascade: the whole view is already rising as one
                block, the same way the other tabs do. */}
            <NodeGrid
              items={filteredItems}
              loading={loading}
              cascade={false}
              onCardClick={handleItemClick}
              nodeTypes={space?.nodeTypes}
              aliases={space?.aliases as SpaceAlias[] | undefined}
            />
          </div>
        </div>
      </ContentReveal>
    </div>
  );
}
