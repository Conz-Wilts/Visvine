'use client';

import React, { Suspense, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import NodeGrid from '@/features/directory/components/NodeGrid';
import DirectoryToolbar from '@/features/directory/components/DirectoryToolbar';
import DirectoryTableView from '@/features/directory/components/table/DirectoryTableView';
import ResourcesBrowser from '@/features/resources/components/ResourcesBrowser';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { prefetchNoteContext } from '@/features/notes/lib/contextPrefetch';
import { ensureRootIndexNote, ROOT_INDEX_PATH } from '@/features/notes/lib/rootIndex';
import { noteHref } from '@/lib/notes/entities';
import type { SpaceAlias } from '@/lib/types';

const DIRECTORY_TABS: PaneTabItem[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'table', label: 'Table' },
  { id: 'context', label: 'Context' },
  { id: 'resources', label: 'Resources' },
];

/** The views this page renders itself; Context is a navigation, not a view. */
type DirectoryView = 'grid' | 'table' | 'resources';

const VIEW_HREF: Record<DirectoryView, string> = {
  grid: '/directory',
  table: '/directory?view=table',
  resources: '/directory?view=resources',
};

/**
 * The Directory: a searchable, filterable card grid of everyone and everything
 * (Grid), the same entries as rows with a column per thing their type tracks
 * (Table, `?view=table&type=<type>`), and the space's Drive (Resources,
 * `?view=resources`). The Context tab
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
  const router = useRouter();
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
  const openContext = useCallback(() => {
    if (!spaceId) return;
    prefetchNoteContext(spaceId, ROOT_INDEX_PATH);
    void ensureRootIndexNote(spaceId, spaceName).then(() => router.push(noteHref(ROOT_INDEX_PATH)));
  }, [spaceId, spaceName, router]);

  // The view is the URL, so a tab survives reload and a link can name it.
  // ?view=context has no standalone browser behind it: such links land on the
  // grid and hop straight to the index note.
  const searchParams = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: DirectoryView = viewParam === 'resources' || viewParam === 'table' ? viewParam : 'grid';
  const typeParam = searchParams.get('type');
  const wantsContext = viewParam === 'context';
  const redirected = useRef(false);
  useEffect(() => {
    if (!wantsContext || redirected.current || !spaceId) return;
    redirected.current = true;
    openContext();
  }, [wantsContext, spaceId, openContext]);

  // Selecting Grid closes any docked tree now, skipping the release grace:
  // the grace exists for navigations where another surface re-claims the dock,
  // but Grid is a terminal state — waiting just holds the closing panel over
  // cards that are already animating in. The dock is NOT released for Context —
  // the note page re-claims it, and the release grace bridges the swap.
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid' || id === 'table' || id === 'resources') {
        releaseDockNow();
        router.replace(VIEW_HREF[id]);
        return;
      }
      openContext();
    },
    [releaseDockNow, openContext, router],
  );
  usePaneChrome({
    tabs: noSpace ? null : DIRECTORY_TABS,
    activeId: view,
    onSelect: handleSelect,
    attachedOpen: false,
    ariaLabel: 'Directory views',
    surface: null,
  });

  const browse = useDirectoryBrowse();
  const { space, loading, error, filteredItems, handleItemClick } = browse;

  // The table's type rides the URL beside the view, so a link can name
  // "the events table" and a reload lands back on it.
  const handleTypeChange = useCallback(
    (type: string) => router.replace(`/directory?view=table&type=${encodeURIComponent(type)}`),
    [router],
  );

  // No space selected (zero memberships): the sidebar rail is already empty,
  // so the directory chrome — tab bar, toolbar, grid — hides too. The centre
  // stays blank on purpose; Discover is reachable from the navbar and the
  // space switcher, so no prompt sits in the middle of the app. Nothing is
  // rendered at all — a min-height filler here would overflow <main>'s own
  // padded height and leave a scrollbar on an empty page.
  if (noSpace) return null;

  if (view === 'table') {
    return (
      // A fixed height, not a minimum: the table is its own scroll box and
      // has to know where the pane ends (DirectoryTableView).
      <div className="relative w-full" style={{ height: 'calc(100dvh - 136px)' }}>
        <div id="panel-table" role="tabpanel" className="h-full">
          <DirectoryTableView browse={browse} type={typeParam} onTypeChange={handleTypeChange} />
        </div>
      </div>
    );
  }

  if (view === 'resources') {
    return (
      <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 136px)' }}>
        <div id="panel-resources" role="tabpanel">
          <ResourcesBrowser />
        </div>
      </div>
    );
  }

  return (
    // The surface fills the pane exactly, so a short grid has nothing to
    // scroll: 64px navbar + <main>'s pt-4/pb-6 is 104px, plus the 32px the
    // pane tab bar takes in flow (48px row, 16px of it pulled back by -mt-4).
    <div className="relative w-full" style={{ minHeight: 'calc(100dvh - 136px)' }}>
      {/* Search, filters, sort and count ride one sticky toolbar welded under
          the pane tab bar; the cards scroll beneath it. */}
      <div id="panel-grid" role="tabpanel">
        <DirectoryToolbar browse={browse} />

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

            <NodeGrid
              items={filteredItems}
              loading={loading}
              onCardClick={handleItemClick}
              nodeTypes={space?.nodeTypes}
              aliases={space?.aliases as SpaceAlias[] | undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
