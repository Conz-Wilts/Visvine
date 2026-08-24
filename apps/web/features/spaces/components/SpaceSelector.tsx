'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import NewSpaceDialog from './NewSpaceDialog';
import { spacePath } from '@/lib/spaces/hierarchy';
import type { Space } from '@/lib/types';

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
  const { currentSpace, joinedSpaces, setCurrentSpace, isAdmin } = useSpace();
  const [isOpen, setIsOpen] = useState(false);
  // Provisioning a space isn't one of the create-panel types — it's the one
  // action that takes you OUT of the space you're in, so it belongs to the
  // switcher rather than the "+" grid. `inside` = create it within the current
  // space (docs/sub-spaces.md) rather than at the root.
  const [creating, setCreating] = useState<null | { inside: boolean }>(null);
  // Spaces nest: the list is a tree, roots first, each root's children under
  // it once opened. The current space's ancestors start open so you can see
  // where you are.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
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

  const byId = useMemo(() => new Map(joinedSpaces.map(s => [s.id, s])), [joinedSpaces]);
  const childrenOf = useMemo(() => {
    const out = new Map<string, Space[]>();
    for (const s of joinedSpaces) {
      if (s.parentId && byId.has(s.parentId)) out.set(s.parentId, [...(out.get(s.parentId) ?? []), s]);
    }
    return out;
  }, [joinedSpaces, byId]);
  // A space whose parent you are not in is a root as far as your list goes.
  const roots = useMemo(
    () => joinedSpaces.filter(s => !s.parentId || !byId.has(s.parentId)),
    [joinedSpaces, byId],
  );
  const trail = useMemo(
    () => (currentSpace ? spacePath(currentSpace.id, byId) : []),
    [currentSpace, byId],
  );

  useEffect(() => {
    if (!isOpen) return;
    setOpenIds(new Set(trail.slice(0, -1).map(s => s.id)));
  }, [isOpen, trail]);

  // Rows in display order, with the depth each one sits at. A search flattens
  // the tree: every match, ranked, labelled with its trail.
  const rows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      return joinedSpaces
        .map(space => ({ space, score: scoreSpace(space.name, query) }))
        .filter(({ score }) => score > -Infinity)
        .sort((a, b) => b.score - a.score)
        .map(({ space }) => ({ space, depth: 0, trail: spacePath(space.id, byId).slice(0, -1) }));
    }
    const out: Array<{ space: Space; depth: number; trail: Space[] }> = [];
    const walk = (space: Space, depth: number) => {
      out.push({ space, depth, trail: [] });
      if (!openIds.has(space.id)) return;
      for (const child of childrenOf.get(space.id) ?? []) walk(child, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return out;
  }, [joinedSpaces, roots, childrenOf, openIds, searchQuery, byId]);

  const toggleOpen = (id: string) =>
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

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
            {trail.length > 1 && (
              <span className="font-medium text-text-muted">
                {trail.slice(0, -1).map(s => s.name).join(' / ')}
                {' / '}
              </span>
            )}
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
                rows.map(({ space, depth, trail: rowTrail }) => {
                  const kids = childrenOf.get(space.id)?.length ?? 0;
                  const expandable = !searchQuery.trim() && kids > 0;
                  const expanded = openIds.has(space.id);
                  return (
                    <div
                      key={space.id}
                      className={`flex items-center hover:bg-surface-2 transition ${
                        currentSpace?.id === space.id ? 'bg-surface-2' : ''
                      }`}
                      style={{ paddingLeft: depth * 20 }}
                    >
                      {expandable ? (
                        <button
                          type="button"
                          aria-label={expanded ? `Collapse ${space.name}` : `Expand ${space.name}`}
                          onClick={() => toggleOpen(space.id)}
                          className="ml-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:text-text-primary"
                        >
                          <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span className="ml-2 h-6 w-6 shrink-0" />
                      )}
                      <button
                        onClick={() => handleSelect(space.id)}
                        className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-4 pl-1 text-left"
                      >
                        <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="md" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium text-text-primary">{space.name}</span>
                          {(rowTrail.length > 0 || kids > 0) && (
                            <span className="truncate text-xs text-text-muted">
                              {rowTrail.length > 0
                                ? rowTrail.map(s => s.name).join(' / ')
                                : `${kids} ${kids === 1 ? 'space' : 'spaces'} inside`}
                            </span>
                          )}
                        </span>
                        {currentSpace?.id === space.id && (
                          <svg className="w-5 h-5 shrink-0 text-brand-green" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="p-2 border-t border-border-subtle bg-surface-2 flex flex-col gap-1">
              <button
                type="button"
                onClick={() => { setIsOpen(false); setCreating({ inside: false }); }}
                className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-center text-text-primary hover:text-brand-dark-green font-medium"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Create space
              </button>
              {/* Only an admin of the space you're in: the server asks for write
                  standing over its communities/ folder, and admins always have it. */}
              {currentSpace && isAdmin && (
                <button
                  type="button"
                  onClick={() => { setIsOpen(false); setCreating({ inside: true }); }}
                  className="flex w-full items-center justify-center gap-2 px-3 py-2 text-sm text-center text-text-primary hover:text-brand-dark-green font-medium"
                >
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="truncate">Create subspace</span>
                </button>
              )}
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

      {creating && (
        <NewSpaceDialog
          onClose={() => setCreating(null)}
          parent={creating.inside && currentSpace ? { id: currentSpace.id, name: currentSpace.name } : null}
        />
      )}
    </div>
  );
}
