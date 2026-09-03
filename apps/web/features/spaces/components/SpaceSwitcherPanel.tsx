'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { ITEM_GAP, LABEL_ML, ROW_CLASS, ROW_H, ROW_INSET, ROW_TEXT } from '@/features/shared/components/layout/railRow';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { ChevronRightIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { scoreName } from '@/lib/rankName';
import { nestSpaces } from '@/lib/spaces/subspaces';

/**
 * The space switcher — the search and the list of every space you are in — as
 * a panel of the rail rather than a popup over the page: a layer against the
 * open rail's edge, the card's full height, sliding out from under the rail
 * the way Create new does, so the rail reads as widening into the list. Opened
 * from the space at the rail's head (SpaceSelector) through the sidebar
 * context; always mounted so the column can slide it, parked off to the left
 * while shut.
 *
 * It opens under the pointer, from the space at the rail's head, and shuts when the
 * pointer leaves the card (Sidebar). Search first, because the list is as
 * long as your memberships. Choosing a space closes it; so do Escape and
 * navigating away. No backdrop: a click-catcher portalled from here would
 * still be inside the card's React tree, and the card's mouseleave — the
 * close — would never fire over it.
 */
export default function SpaceSwitcherPanel() {
  const { switcherOpen: isOpen, setSwitcherOpen, reduced } = useSidebar();
  const { currentSpace, joinedSpaces, setCurrentSpace } = useSpace();
  const pathname = usePathname();
  const [query, setQuery] = useState('');
  // Parents folded shut, by id. A parent starts open: its sub-spaces are
  // part of what you are in.
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const close = () => setSwitcherOpen(false);
  useEscapeKey(close, isOpen);

  // Opening focuses the search once the panel has slid out; closing clears it
  // after the slide, so the list does not visibly reset on its way behind the
  // rail.
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

  // Rows in display order: every space you are in, ranked by the search when
  // there is one, alphabetical otherwise — as a tree one level deep, each
  // sub-space you are in under its parent when the parent is in the list too
  // (lib/spaces/subspaces.ts#nestSpaces), folded away by the parent's
  // chevron. A search flattens: the match is what you are looking at.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      const nested = nestSpaces([...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name)));
      const parents = new Set(nested.filter((r) => r.nested).map((r) => r.space.parentId as string));
      return nested
        .filter((r) => !r.nested || !folded.has(r.space.parentId as string))
        .map((r) => ({ ...r, parent: parents.has(r.space.id) }));
    }
    return joinedSpaces
      .map((space) => ({ space, score: scoreName(space.name, q) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => ({ space, nested: false, parent: false }));
  }, [joinedSpaces, query, folded]);

  const toggleFold = (id: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
            one. Each is a rail row — the avatar centred in the rail's glyph
            cell, the name beside it at the rail's size — so the list reads as
            the rail continuing rather than a menu beside it. A sub-space
            steps its whole row in under its parent. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto pb-3" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No spaces found</div>
          ) : (
            <div className="flex flex-col" style={{ gap: ITEM_GAP }}>
            {rows.map(({ space, nested, parent }) => {
              const current = currentSpace?.id === space.id;
              const expanded = parent && !folded.has(space.id);
              return (
                <div key={space.id} className="relative">
                <button
                  type="button"
                  onClick={() => select(space.id)}
                  tabIndex={isOpen ? 0 : -1}
                  className={`${ROW_CLASS} min-w-0 text-left ${current ? 'bg-surface-3 font-semibold' : 'font-normal'}`}
                  style={{ height: ROW_H, paddingLeft: nested ? 24 : 0, paddingRight: parent ? ROW_H : 16, color: current ? 'var(--shell-fg-strong, #111827)' : 'var(--shell-fg-muted, #111827)' }}
                >
                  <span className="flex shrink-0 items-center justify-center" style={{ width: ROW_H, height: ROW_H }}>
                    <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" />
                  </span>
                  <span className={`${ROW_TEXT} min-w-0 flex-1 truncate`} style={{ marginLeft: LABEL_ML }}>{space.name}</span>
                  {current && (
                    <svg className="h-4 w-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
                {/* The chevron is its own control on the row's trailing cell,
                    so folding the sub-spaces never switches space. */}
                {parent && (
                  <button
                    type="button"
                    aria-label={expanded ? `Hide ${space.name} sub-spaces` : `Show ${space.name} sub-spaces`}
                    aria-expanded={expanded}
                    tabIndex={isOpen ? 0 : -1}
                    onClick={(e) => { e.stopPropagation(); toggleFold(space.id); }}
                    className="absolute right-0 top-0 z-20 flex items-center justify-center text-text-muted transition-colors hover:text-text-primary [&>svg]:h-5 [&>svg]:w-5"
                    style={{ width: ROW_H, height: ROW_H }}
                  >
                    <span className="transition-transform duration-150" style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}>
                      <ChevronRightIcon />
                    </span>
                  </button>
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
