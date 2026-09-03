'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { SHELL_TOP_BAR_H } from '@/features/shared/contexts/ThemeContext';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';

// Predictable, ranked matching for the space switcher. Name-only (like the main
// directory search) so it stays predictable — these are spaces you already know
// by name, and matching descriptions made every venture firm match "ven".
// Ranking: exact > prefix > word-start > substring. Returns -Infinity for no match.
function scoreSpace(name: string, query: string): number {
  const lower = name.toLowerCase();
  if (lower === query) return 100000;
  if (lower.startsWith(query)) return 90000 - query.length;
  // Any word in the name starts with the query, e.g. "ven" → "Blackbird Ventures".
  if (lower.split(/[^a-z0-9]+/).some(word => word.startsWith(query))) {
    return 80000 - lower.indexOf(query);
  }
  const idx = lower.indexOf(query);
  if (idx > 0) return 70000 - idx * 10;
  return -Infinity;
}

/**
 * The space switcher — the search and the list of every space you are in — as
 * a panel of the rail rather than a popup over the page: a layer against the
 * open rail's edge, the card's full height, sliding out from under the rail
 * the way Create new does, so the rail reads as widening into the list. Opened
 * from the space at the rail's head (SpaceSelector) through the sidebar
 * context; always mounted so the column can slide it, parked off to the left
 * while shut.
 *
 * It opens under the pointer, from the Switch space row, and shuts when the
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
  // there is one, alphabetical otherwise. A flat list — a space is a tenant of
  // its own and sits beside the rest.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name));
    return joinedSpaces
      .map((space) => ({ space, score: scoreSpace(space.name, q) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => space);
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
            does. No title: the row that opened it says what it is. */}
        <div className="flex flex-shrink-0 items-center px-3" style={{ height: SHELL_TOP_BAR_H }}>
          <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 transition-colors focus-within:border-brand-green">
            <svg className="h-3.5 w-3.5 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search spaces…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              tabIndex={isOpen ? 0 : -1}
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Every space you are a member of, ranked by the search when there is
            one. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No spaces found</div>
          ) : (
            rows.map((space) => {
              const current = currentSpace?.id === space.id;
              return (
                <button
                  key={space.id}
                  type="button"
                  onClick={() => select(space.id)}
                  tabIndex={isOpen ? 0 : -1}
                  className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2 ${current ? 'bg-surface-2' : ''}`}
                >
                  <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="sm" />
                  <span className={`min-w-0 flex-1 truncate text-sm text-text-primary ${current ? 'font-semibold' : ''}`}>{space.name}</span>
                  {current && (
                    <svg className="h-4 w-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              );
            })
          )}
        </div>
      </aside>
  );
}
