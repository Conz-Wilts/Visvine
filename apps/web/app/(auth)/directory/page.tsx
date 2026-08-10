'use client';

import React, { Suspense, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import NodeGrid from '@/features/directory/components/NodeGrid';
import DirectoryToolbar from '@/features/directory/components/DirectoryToolbar';
import { usePaneChrome, type PaneTabItem } from '@/features/shared/contexts/PaneShellContext';
import { useDirectoryBrowse } from '@/features/directory/hooks/useDirectoryBrowse';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { cachedFetch, contextKeys, prefetchNoteContext } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import { noteHref } from '@/lib/notes/entities';
import type { CommunityAlias } from '@/lib/types';

// The knowledge browser pulls in the note tree, the virtualized grid and the
// reference panels. Defer it so the Grid view never downloads it — it only
// loads when the Context tab is opened.
const ContextBrowser = dynamic(() => import('@/features/notes/components/ContextBrowser'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">Loading context…</div>
  ),
});

type DirectoryView = 'grid' | 'context';

const DIRECTORY_TABS: PaneTabItem[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'context', label: 'Context' },
];

/**
 * The Directory: a Grid / Context switcher over the community. Grid is the
 * searchable, filterable card grid of everyone and everything; Context is the
 * knowledge browser over the community's notes and how they connect. Views swap
 * purely client-side, so switching is instant and never re-runs the shell
 * layout. The bar itself lives in the persistent pane shell
 * (directory/layout.tsx) — this page just registers its tabs and view state.
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
  // ?view=context opens straight on the Context tab — that's how /context and
  // anything else that used to link to a standalone page gets here. After the
  // first render the tab bar owns the view; it never writes back to the URL.
  const initialView: DirectoryView = useSearchParams().get('view') === 'context' ? 'context' : 'grid';
  const [view, setView] = useState<DirectoryView>(initialView);
  const router = useRouter();
  const { currentCommunity } = useCommunity();
  const communityId = currentCommunity?.id ?? null;
  const { releaseDockNow } = useContextPanel();
  // Switching to Grid closes any docked tree now, skipping the release grace:
  // the grace exists for navigations where another surface re-claims the dock,
  // but Grid is a terminal state — waiting just holds the closing panel over
  // cards that are already animating in.
  //
  // Context navigates to the brain's top-level index note (`index.md` — the
  // hand-written home page, e.g. "Blackbird Ventures") rather than swapping in
  // the three-column browser; the browser stays reachable at ?view=context.
  // The dock is NOT released here — the note page re-claims it, and the release
  // grace bridges the swap. A brain without a root index falls back to the
  // browser: the note page's missing state is an access-request card, which is
  // the wrong surface for "this note was never written".
  const handleSelect = useCallback(
    (id: string) => {
      if (id === 'grid') {
        releaseDockNow();
        setView('grid');
        return;
      }
      if (!communityId) {
        setView('context');
        return;
      }
      prefetchNoteContext(communityId, 'index.md');
      cachedFetch(contextKeys.list(communityId), () => notesApi.list(communityId))
        .then(({ notes }) => {
          if (notes.some((n) => n.path === 'index.md')) router.push(noteHref('index.md'));
          else setView('context');
        })
        .catch(() => router.push(noteHref('index.md')));
    },
    [communityId, releaseDockNow, router],
  );
  usePaneChrome({
    tabs: DIRECTORY_TABS,
    activeId: view,
    onSelect: handleSelect,
    attachedOpen: false,
    ariaLabel: 'Directory views',
    surface: null,
  });

  const browse = useDirectoryBrowse();
  const { community, loading, error, filteredItems, handleItemClick } = browse;

  return (
    <div
      className={`relative w-full ${view === 'context' ? 'flex flex-col' : ''}`}
      // Context is a fixed three-column surface — pin the root to the space left
      // below the shell's tab bar (viewport − navbar 64px − main's pt-4/pb-6 =
      // 40px − the bar's 32px of flow height: a 48px row minus its -mt-4
      // pull-up), so the page never scrolls vertically and each column scrolls
      // on its own. Grid keeps the tall min-height and scrolls <main>.
      style={
        view === 'context'
          ? { height: 'calc(100dvh - 64px - 40px - 32px)' }
          : { minHeight: 'calc(100dvh - 56px)' }
      }
    >
      {/* Grid: search, filters, sort and count ride one sticky toolbar welded
          under the pane tab bar; the cards scroll beneath it. */}
      {view === 'grid' && (
        <div id="panel-grid" role="tabpanel">
          <DirectoryToolbar browse={browse} />

          <div className="w-full px-6 pt-4 pb-8">
            <div className="flex flex-col gap-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <NodeGrid
                items={filteredItems}
                loading={loading}
                onCardClick={handleItemClick}
                nodeTypes={community?.nodeTypes}
                communityAliases={community?.communityAliases as CommunityAlias[] | undefined}
              />
            </div>
          </div>
        </div>
      )}

      {/* Context: the knowledge browser, filling the pane below the tab row. It
          brings its own folder rail, so nothing docks into the Sidebar here. */}
      {view === 'context' && (
        <div id="panel-context" role="tabpanel" className="min-h-0 flex-1 overflow-hidden">
          <ContextBrowser />
        </div>
      )}
    </div>
  );
}
