'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ITEM_GAP, ROW_H, ROW_INSET } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { SpaceListRow } from '@/features/spaces/components/SpaceListRow';
import { scoreName } from '@/lib/rankName';
import { spaceBranches } from '@/lib/spaces/subspaces';

/**
 * The space switcher — the search and the list of every space you are in — as
 * a panel of the rail rather than a popup over the page: a layer against the
 * open rail's edge, the card's full height, sliding out from under the rail
 * the way Create new does, so the rail reads as widening into the list. Opened
 * from the space at the rail's head (SpaceSelector) through the sidebar
 * context; always mounted so the column can slide it, parked off to the left
 * while shut.
 *
 * It opens under the pointer, from the space at the rail's head; the rail shuts to its
 * glyph column once the pointer is in it, and the list slides left with it. It shuts when the
 * pointer leaves the card (Sidebar). Search first, because the list is as
 * long as your memberships. Choosing a space closes it; so do Escape and
 * navigating away. No backdrop: a click-catcher portalled from here would
 * still be inside the card's React tree, and the card's mouseleave — the
 * close — would never fire over it.
 *
 * This column holds TOP-LEVEL spaces only. Pointing at one that has sub-spaces
 * opens them in a column of their own beside this one (SubspacePanel) — the
 * rail keeps widening rather than indenting, so a sub-space's row is as wide
 * and as readable as its parent's.
 */
export default function SpaceSwitcherPanel() {
  const { switcherOpen: isOpen, setSwitcherOpen, switcherParentId, setSwitcherParentId, reduced } = useSidebar();
  const { currentSpace, joinedSpaces, setCurrentSpace } = useSpace();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => setSwitcherOpen(false);
  useEscapeKey(close, isOpen);

  // Opening focuses the search once the panel has slid out; closing clears it
  // after the slide, so the list does not visibly reset on its way behind the
  // rail. The sub-space column is already gone by then — closing the switcher
  // sends it home first (SidebarContext), so the two never travel at once.
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduced ? 0 : DOCK_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setQuery(''), reduced ? 0 : DOCK_MS);
    return () => clearTimeout(t);
  }, [isOpen, reduced]);

  useEffect(() => {
    setSwitcherOpen(false);
  }, [pathname, setSwitcherOpen]);

  // Rows in display order: the spaces you are in, ranked by the search when
  // there is one, alphabetical otherwise. One level — a sub-space is carried
  // by its parent's branch (lib/spaces/subspaces.ts#spaceBranches) and drawn
  // in the column beside this one. A search flattens the whole tree: the match
  // is what you are looking for, wherever it sits.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return spaceBranches([...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return joinedSpaces
      .map((space) => ({ space, score: scoreName(space.name, q) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => ({ space, children: [] }));
  }, [joinedSpaces, query]);

  // A search flattens, so nothing is holding a sub-space column open under it.
  useEffect(() => {
    if (query.trim()) setSwitcherParentId(null);
  }, [query, setSwitcherParentId]);

  const select = (spaceId: string) => {
    setCurrentSpace(spaceId);
    close();
  };

  return (
      <aside
        role="dialog"
        aria-label="Switch space"
        aria-hidden={!isOpen}
        className={`absolute inset-0 z-10 flex flex-col overflow-hidden border-r border-border-subtle bg-surface-1 ${isOpen ? '' : 'pointer-events-none'}`}
        // Inline, not `-translate-x-full`: Tailwind v4 compiles translate
        // utilities to the `translate` property, which a `transition:
        // transform` never animates.
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: reduced ? 'none' : `transform ${DOCK_MS}ms ${DOCK_EASE}`,
        }}
      >
        {/* Search first, at the very top, level with the space in the rail's
            head — this is the rail continuing, so it starts where the rail
            does, and the search is one rail row tall so the rows below it
            line up with the rail's. No title: the row that opened it says
            what it is. */}
        <div className="flex flex-shrink-0 items-center px-3" style={{ height: ROW_H }}>
          <div className="flex h-12 w-full items-center gap-2.5 rounded-xl border border-border-default bg-surface-1 px-4 transition-colors focus-within:border-brand-green">
            <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search spaces…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              tabIndex={isOpen ? 0 : -1}
              className="min-w-0 flex-1 bg-transparent text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Every space you are a member of, ranked by the search when there is
            one. Pointing at a row with sub-spaces opens their column; pointing
            at one without shuts whatever column was open, so the pair always
            says which parent you are inside. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-3" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No spaces found</div>
          ) : (
            <div className="flex flex-col" style={{ gap: ITEM_GAP }}>
              {rows.map(({ space, children }) => (
                <SpaceListRow
                  key={space.id}
                  space={space}
                  current={currentSpace?.id === space.id}
                  hasChildren={children.length > 0}
                  open={switcherParentId === space.id}
                  tabbable={isOpen}
                  onSelect={() => select(space.id)}
                  onOpen={() => setSwitcherParentId(children.length > 0 ? space.id : null)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
  );
}
