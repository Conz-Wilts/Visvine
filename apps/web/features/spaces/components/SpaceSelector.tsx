'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useSession } from '@/features/auth/lib/auth-client';
import { CheckIcon, ChevronsUpDownIcon, PlusIcon, SearchIcon, SettingsIcon, UsersIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { HEAD_CELL_W, ROW_H, ROW_INSET } from '@/features/shared/components/layout/railRow';
import Popover, { PopoverDivider, PopoverHeading, PopoverItem } from '@/components/ui/Popover';
import { scoreName } from '@/lib/rankName';
import { spaceBranches } from '@/lib/spaces/subspaces';
import type { Space } from '@/lib/types';
import NewSpaceDialog from './NewSpaceDialog';

/**
 * The space at the rail's head, and the menu that hangs off it. The row is the
 * space's avatar and name on the rail's own glyph column; PRESSING it opens
 * one menu beside the rail — the shape every workspace app settles on for its
 * top-left corner — and pressing it again, Escape, or a press anywhere else
 * closes it. Nothing here opens on hover: a hover menu needs a steady hand,
 * does nothing on a touch screen, and stands in the way of a pointer crossing
 * the rail on its way to a tool.
 *
 * The menu is the space's whole account of itself: the space you are in at the
 * top, what you can do to it (the console and its members, for admins), New
 * space, then Switch space — a search when the list is long, and every space
 * you are in with its sub-spaces one step in beneath it. A sub-space is its
 * own tenant, so choosing one IS switching space.
 *
 * Provisioning a space isn't one of the create-panel types — it's the one
 * action that takes you OUT of the space you're in, so it belongs here rather
 * than to the "+" grid. Discover is not a row of the menu: it is already the
 * top group's own row, directly below.
 */
export default function SpaceSelector() {
  const { currentSpace, isAdmin, joinedSpaces, setCurrentSpace } = useSpace();
  const { expanded, reduced, setMenuOpen } = useSidebar();
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  // The console is the space's own settings, so it hangs off the space — not
  // off a rail row of its own. Same gate the console page applies.
  const canManage = Boolean(currentSpace) && (isAdmin || session?.user?.isSuperAdmin === true);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const open = anchor !== null;

  // The rail is held open under the menu (SidebarContext), and let go when the
  // menu is — whichever way it went.
  useEffect(() => {
    setMenuOpen(open);
    return () => setMenuOpen(false);
  }, [open, setMenuOpen]);

  // Going somewhere closes the menu, whichever row got you there.
  useEffect(() => setAnchor(null), [pathname]);

  const close = () => setAnchor(null);
  const toggle = () => setAnchor((a) => (a ? null : triggerRef.current));

  const byId = useMemo(() => new Map(joinedSpaces.map((s) => [s.id, s])), [joinedSpaces]);
  const parent = currentSpace?.parentId ? byId.get(currentSpace.parentId) : undefined;

  const select = (spaceId: string) => {
    close();
    setCurrentSpace(spaceId);
  };

  return (
    <div className="relative flex flex-col">
      <div style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
        <button
          ref={triggerRef}
          type="button"
          onClick={toggle}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={currentSpace ? `${currentSpace.name} — space menu` : 'Space menu'}
          className={`relative z-10 flex w-full items-center transition-colors duration-150 hover:bg-surface-3 focus:outline-none focus-visible:bg-surface-3 ${
            open ? 'bg-surface-3' : ''
          }`}
          style={{ height: ROW_H }}
        >
          <span className="flex shrink-0 items-center justify-center" style={{ width: HEAD_CELL_W, height: ROW_H }}>
            {currentSpace ? (
              <SpaceAvatar name={currentSpace.name} imageUrl={currentSpace.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
            ) : (
              <div className="w-10 h-10 rounded-[10px] bg-surface-3 flex-shrink-0" />
            )}
          </span>
          {/* The name stays mounted so it can FADE with the rail's other labels
              but is transparent and untouchable while the rail is shut. The
              chevrons say the row opens: the one affordance the rail draws,
              because this row is the one that does not go anywhere. */}
          <span
            aria-hidden={!expanded}
            className="ml-2 flex min-w-0 flex-1 items-center gap-2 pr-4"
            style={{
              opacity: expanded ? 1 : 0,
              pointerEvents: expanded ? undefined : 'none',
              transition: reduced ? 'none' : `opacity 140ms ease ${expanded ? 200 : 0}ms`,
            }}
          >
            <span className="min-w-0 flex-1 truncate text-left text-[15px] font-open-sauce font-semibold text-text-primary">
              {currentSpace?.name || 'Select space'}
            </span>
            <span className="flex shrink-0 items-center text-text-muted [&>svg]:h-4 [&>svg]:w-4">
              <ChevronsUpDownIcon />
            </span>
          </span>
        </button>
      </div>

      <Popover anchor={anchor} onClose={close} placement="right-start" width={296} role="dialog" ariaLabel="Space menu" className="p-1.5">
        {currentSpace && (
          <div className="flex items-center gap-3 px-2.5 pb-2 pt-2">
            <SpaceAvatar name={currentSpace.name} imageUrl={currentSpace.imageUrl} size="lg" rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[15px] font-semibold text-text-primary">{currentSpace.name}</div>
              <div className="truncate text-[12px] text-text-muted">
                {parent ? `Sub-space of ${parent.name}` : `${currentSpace.memberCount} ${currentSpace.memberCount === 1 ? 'member' : 'members'}`}
              </div>
            </div>
          </div>
        )}

        {canManage && (
          <>
            <PopoverItem label="Space console" icon={<SettingsIcon />} onClick={() => { close(); router.push('/admin'); }} />
            <PopoverItem label="Members" icon={<UsersIcon />} onClick={() => { close(); router.push('/admin?section=members'); }} />
          </>
        )}
        <PopoverItem label="New space" icon={<PlusIcon />} onClick={() => { close(); setCreating(true); }} />

        <PopoverDivider />
        <PopoverHeading>Switch space</PopoverHeading>
        <SpaceList spaces={joinedSpaces} currentId={currentSpace?.id ?? null} onSelect={select} />
      </Popover>

      {creating && <NewSpaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** Searching is worth a field once the list is longer than a glance. */
const SEARCH_FROM = 6;

/**
 * Every space you are in: the top-level ones in name order, each followed by
 * its sub-spaces one step in (lib/spaces/subspaces.ts#spaceBranches). A search
 * flattens the tree and ranks — the match is what you are looking for,
 * wherever it sits.
 */
function SpaceList({
  spaces,
  currentId,
  onSelect,
}: {
  spaces: Space[];
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sorted = useMemo(() => [...spaces].sort((a, b) => a.name.localeCompare(b.name)), [spaces]);

  const rows: Array<{ space: Space; indent: boolean }> = useMemo(() => {
    if (!q) {
      return spaceBranches(sorted).flatMap(({ space, children }) => [
        { space, indent: false },
        ...children.map((child) => ({ space: child, indent: true })),
      ]);
    }
    return sorted
      .map((space) => ({ space, score: scoreName(space.name, q) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => ({ space, indent: false }));
  }, [sorted, q]);

  const check = (
    <span className="flex shrink-0 items-center text-brand-green [&>svg]:h-4 [&>svg]:w-4">
      <CheckIcon />
    </span>
  );

  return (
    <>
      {spaces.length >= SEARCH_FROM && (
        <div className="px-1.5 pb-1.5">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border-default bg-surface-1 px-2.5 transition-colors focus-within:border-brand-green">
            <span className="flex shrink-0 items-center text-text-muted [&>svg]:h-4 [&>svg]:w-4">
              <SearchIcon />
            </span>
            <input
              autoFocus
              type="text"
              placeholder="Search spaces…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none"
            />
          </div>
        </div>
      )}
      <div className="custom-scrollbar max-h-[min(44vh,420px)] overflow-y-auto">
        {rows.length === 0 ? (
          <div className="px-2.5 py-3 text-center text-[13px] text-text-muted">No spaces found</div>
        ) : (
          rows.map(({ space, indent }) => (
            <PopoverItem
              key={space.id}
              label={space.name}
              indent={indent}
              icon={indent ? undefined : <SpaceAvatar name={space.name} imageUrl={space.imageUrl} size="sm" rounded="rounded-md" />}
              current={space.id === currentId}
              trailing={space.id === currentId ? check : undefined}
              onClick={() => onSelect(space.id)}
            />
          ))
        )}
      </div>
    </>
  );
}
