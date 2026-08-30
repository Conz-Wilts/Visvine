'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
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

export default function SpaceSelector({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const { currentSpace, joinedSpaces, setCurrentSpace } = useSpace();
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
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        className={
          iconOnly
            ? "w-12 h-12 rounded-xl flex items-center justify-center shell-icon-btn"
            : "flex items-center gap-2 h-12 px-3 text-sm font-medium rounded-xl shell-icon-btn"
        }
      >
        {currentSpace ? (
          <SpaceAvatar name={currentSpace.name} imageUrl={currentSpace.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
        ) : (
          <div className="w-10 h-10 rounded-[10px] bg-surface-3 flex-shrink-0" />
        )}
        {!iconOnly && (
          <span className="hidden md:inline font-open-sauce font-semibold text-text-primary truncate max-w-[22rem]">
            {currentSpace?.name || 'Select Space'}
          </span>
        )}
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          className="fixed w-80 bg-surface-1 rounded-2xl shadow-float border border-border-subtle z-[60] overflow-hidden"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
            {/* Search Input */}
            <div className="p-3 border-b border-border-subtle">
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

            {/* Spaces List — caps at 5 rows (~56px each) before scrolling */}
            <div className="max-h-[280px] overflow-y-auto custom-scrollbar">
              {rows.length === 0 ? (
                <div className="p-4 text-sm text-text-muted text-center">No spaces found</div>
              ) : (
                rows.map((space) => (
                  <div
                    key={space.id}
                    className={`flex items-center hover:bg-surface-2 transition ${
                      currentSpace?.id === space.id ? 'bg-surface-2' : ''
                    }`}
                  >
                    <button
                      onClick={() => handleSelect(space.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 pl-4 text-left"
                    >
                      <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">{space.name}</span>
                      {currentSpace?.id === space.id && (
                        <svg className="w-5 h-5 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-border-subtle bg-surface-2 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => { setIsOpen(false); setCreating(true); }}
                className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-center text-text-primary hover:text-brand-dark-green font-medium"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create space
              </button>
              <Link
                href="/discover"
                className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-center text-text-primary hover:text-brand-dark-green font-medium"
                onClick={() => setIsOpen(false)}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
                Discover Spaces
              </Link>
            </div>
          </div>,
        document.body
      )}

      {creating && <NewSpaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
