'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ITEM_GAP, ROW_H, ROW_INSET } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { LIST_AVATAR_CENTER, LIST_AVATAR_PX, SpaceListRow, SubspaceRow } from '@/features/spaces/components/SpaceListRow';
import { TreeSpine } from '@/components/ui/TreeChrome';
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
 * The list is a tree one level deep: top-level spaces as rail rows, and a
 * space with sub-spaces you are in opens on its chevron to a row per
 * sub-space hung under it on the tree's spine (TreeSpine) — the same drawing
 * the Context tree and the console's alias lists use. Spaces nest one level
 * (docs/sub-spaces.md), so nothing under a row opens further. The branch the
 * current space is in starts open, so where you are is on screen.
 */
// TreeSpine draws its line 14px in (the tree glyph's centre).
const SPINE_DEFAULT_ML = 14;

export default function SpaceSwitcherPanel() {
  const { switcherOpen: isOpen, setSwitcherOpen, reduced } = useSidebar();
  const { currentSpace, joinedSpaces, setCurrentSpace } = useSpace();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => setSwitcherOpen(false);
  useEscapeKey(close, isOpen);

  // Which branches are open. The current space's own branch starts open each
  // time the list is shown; a press on a chevron opens or shuts any other.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Opening focuses the search once the panel has slid out and opens the
  // branch you are in; closing clears both after the slide, so the list does
  // not visibly reset on its way behind the rail.
  useEffect(() => {
    if (isOpen) {
      setExpanded(new Set(currentSpace?.parentId ? [currentSpace.parentId] : []));
      const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), reduced ? 0 : DOCK_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setQuery(''); setExpanded(new Set()); }, reduced ? 0 : DOCK_MS);
    return () => clearTimeout(t);
    // The branch is read once at open; switching space closes the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, reduced]);

  useEffect(() => {
    setSwitcherOpen(false);
  }, [pathname, setSwitcherOpen]);

  // Rows in display order: the spaces you are in, ranked by the search when
  // there is one, alphabetical otherwise. One level — a sub-space is carried
  // by its parent's branch (lib/spaces/subspaces.ts#spaceBranches) and drawn
  // under it. A search flattens the whole tree: the match is what you are
  // looking for, wherever it sits.
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
            one. A row with sub-spaces opens them under itself on its chevron:
            the spine drops out of the parent's avatar and ticks into each
            sub-space, ending at the last, so the branch reads as one drawing
            rather than an indent. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No spaces found</div>
          ) : (
            <div className="flex flex-col" style={{ gap: ITEM_GAP }}>
              {rows.map(({ space, children }) => {
                const open = children.length > 0 && expanded.has(space.id);
                return (
                  <div key={space.id}>
                    <SpaceListRow
                      space={space}
                      current={currentSpace?.id === space.id}
                      hasChildren={children.length > 0}
                      open={open}
                      tabbable={isOpen}
                      onSelect={() => select(space.id)}
                      onToggle={() => toggle(space.id)}
                    />
                    {open && (
                      // The spine sits under the centre of the parent's avatar,
                      // not TreeSpine's default 14px, and its stem climbs from
                      // the branch's top to the avatar's bottom edge.
                      <div style={{ marginLeft: LIST_AVATAR_CENTER - SPINE_DEFAULT_ML }}>
                        <TreeSpine animate={!reduced} stem={ROW_H / 2 - LIST_AVATAR_PX / 2}>
                          {children.map((child, i) => (
                            <SubspaceRow
                              key={child.id}
                              space={child}
                              current={currentSpace?.id === child.id}
                              nested={i === children.length - 1 ? 'last' : 'mid'}
                              tabbable={isOpen}
                              onSelect={() => select(child.id)}
                            />
                          ))}
                        </TreeSpine>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
  );
}
