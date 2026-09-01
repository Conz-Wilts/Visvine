'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useSession } from '@/features/auth/lib/auth-client';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import NewSpaceDialog from './NewSpaceDialog';

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

export default function SpaceSelector() {
  const { currentSpace, joinedSpaces, setCurrentSpace, isAdmin } = useSpace();
  // The shut rail is one glyph column wide. The name and the switch marker stay
  // mounted so they can FADE with the rail's other labels — a name revealed by
  // the widening rail reads as sliding out from under the avatar — but they are
  // transparent and untouchable while it is shut, so the marker never shows as
  // a stray mark past the avatar's edge.
  const { expanded, reduced } = useSidebar();
  const { data: session } = useSession();
  // The console is the space's own settings, so it hangs off the space — not
  // off a rail row of its own. Same gate the console page applies.
  const canManage = Boolean(currentSpace) && (isAdmin || session?.user?.isSuperAdmin === true);
  const [isOpen, setIsOpen] = useState(false);
  // Provisioning a space isn't one of the create-panel types — it's the one
  // action that takes you OUT of the space you're in, so it belongs to the
  // switcher rather than the "+" grid.
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The dropdown is portalled to <body> (so it escapes the sidebar rail's
  // overflow-hidden clip); this anchors it to the trigger's viewport position.
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setMenuPos({ top: rect.bottom + 8, left: rect.left });
  }, [isOpen]);

  // Close the dropdown when clicking anywhere outside it (including other top-bar items).
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  // Rows in display order: every space you are in, ranked by the search when
  // there is one, alphabetical otherwise. A flat list — a space is a tenant of
  // its own and sits beside the rest.
  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name));
    return joinedSpaces
      .map((space) => ({ space, score: scoreSpace(space.name, query) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => space);
  }, [joinedSpaces, searchQuery]);

  const handleSelect = (spaceId: string) => {
    setCurrentSpace(spaceId);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div className="relative" ref={containerRef}>
      {/* Trigger — a rail row: a 48px avatar cell on the rail's glyph column,
          then the space's name, which the collapsed rail clips away. */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="relative z-10 flex h-12 w-full items-center rounded-[10px] transition-colors duration-150 hover:bg-surface-3"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center">
          {currentSpace ? (
            <SpaceAvatar name={currentSpace.name} imageUrl={currentSpace.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
          ) : (
            <div className="w-10 h-10 rounded-[10px] bg-surface-3 flex-shrink-0" />
          )}
        </span>
        <span
          aria-hidden={!expanded}
          className="ml-2.5 flex min-w-0 flex-1 items-center"
          style={{
            opacity: expanded ? 1 : 0,
            pointerEvents: expanded ? undefined : 'none',
            transition: reduced ? 'none' : `opacity 140ms ease ${expanded ? 200 : 0}ms`,
          }}
        >
          <span className="min-w-0 flex-1 truncate text-left text-[15px] font-open-sauce font-semibold text-text-primary">
            {currentSpace?.name || 'Select space'}
          </span>
          <svg className="mr-2 h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
          </svg>
        </span>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed w-80 bg-surface-1 rounded-2xl shadow-float border border-border-subtle z-[60] overflow-hidden"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
            {/* Who you are in, and what it is — the menu opens on the space
                itself rather than straight into a list of other ones. */}
            {currentSpace && (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <SpaceAvatar name={currentSpace.name} imageUrl={currentSpace.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-primary">{currentSpace.name}</p>
                  <p className="truncate text-xs text-text-muted">
                    {currentSpace.visibility === 'private' ? 'Private' : 'Public'}
                    {' · '}
                    {currentSpace.memberCount} {currentSpace.memberCount === 1 ? 'member' : 'members'}
                  </p>
                </div>
              </div>
            )}

            {/* Everywhere else you can go. Search first, because the list is as
                long as your memberships. */}
            <div className="border-t border-border-subtle p-3 pb-2">
              <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 focus-within:border-brand-green transition-colors">
                <svg className="h-3.5 w-3.5 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search spaces…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            {/* Spaces List — caps at 5 rows (~48px each) before scrolling */}
            <div className="max-h-[240px] overflow-y-auto px-1.5 pb-1.5 custom-scrollbar">
              {rows.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">No spaces found</div>
              ) : (
                rows.map((space) => (
                  <button
                    key={space.id}
                    onClick={() => handleSelect(space.id)}
                    className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-2 ${
                      currentSpace?.id === space.id ? 'bg-surface-2' : ''
                    }`}
                  >
                    <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{space.name}</span>
                    {currentSpace?.id === space.id && (
                      <svg className="w-4 h-4 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))
              )}
            </div>

            {/* Everything that is not "switch to another space": what you can do
                TO this one (admins only — a member sees the switcher and nothing
                else), then the two ways out of every space you are in. */}
            <div className="flex flex-col border-t border-border-subtle p-1.5">
              {canManage && (
                <>
                  <Link
                    href="/admin"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                >
                    <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Space management
                  </Link>
                  <Link
                    href="/admin?section=members"
                    onClick={() => setIsOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
                >
                    <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 20h5v-1a3 3 0 00-4-2.83M9 20H2v-1a5 5 0 019.5-2.2M15 7a3 3 0 11-6 0 3 3 0 016 0zm5 2a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Members
                  </Link>
                </>
              )}
              <button
                type="button"
                onClick={() => { setIsOpen(false); setCreating(true); }}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4v16m8-8H4" />
                </svg>
                Create space
              </button>
              <Link
                href="/discover"
                onClick={() => setIsOpen(false)}
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
              >
                <svg className="h-4 w-4 shrink-0 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={1.8} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
                Discover spaces
              </Link>
            </div>
          </div>,
        document.body
      )}

      {creating && <NewSpaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
