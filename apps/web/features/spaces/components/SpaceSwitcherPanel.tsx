'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { DOCK_EASE, DOCK_MS, useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useDesktopChrome } from '@/features/desktop/lib/chrome';
import { ITEM_GAP, ROW_INSET } from '@/features/shared/components/layout/railRow';
import PanelSearch from '@/features/shared/components/layout/PanelSearch';
import { useEscapeKey } from '@/features/shared/hooks/useEscapeKey';
import { LIST_AVATAR_CENTER, LIST_AVATAR_PX, LockedSubspaceRow, NewSpaceRow, NewSubspaceRow, SpaceListRow, SubspaceRow } from '@/features/spaces/components/SpaceListRow';
import NewSpaceDialog from '@/features/spaces/components/NewSpaceDialog';
import RequestSubspaceAccessDialog from '@/features/spaces/components/RequestSubspaceAccessDialog';
import type { LockedSubspace } from '@/lib/spaces/subspaceAccess';
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
 * (docs/sub-spaces.md), so nothing under a row opens further. Every branch
 * starts shut: the list opens as the flat set of spaces you are in.
 */
// TreeSpine draws its line 14px in (the tree glyph's centre).
const SPINE_DEFAULT_ML = 14;

export default function SpaceSwitcherPanel() {
  const { switcherOpen: isOpen, setSwitcherOpen, reduced } = useSidebar();
  const { currentSpace, joinedSpaces, lockedSubspaces, setCurrentSpace, manages } = useSpace();
  const pathname = usePathname();
  // Rows are the rail's square cells, so the spine's stem is half a cell.
  const { railW } = useDesktopChrome();
  const [query, setQuery] = useState('');
  // What is being made: a top-level space, or a sub-space of the row whose
  // branch offered it. One dialog either way (NewSpaceDialog).
  const [creating, setCreating] = useState<null | { id: string; name: string }>(null);
  const [makingSpace, setMakingSpace] = useState(false);
  // The locked row that was pressed — the door, not a space to switch to.
  const [asking, setAsking] = useState<null | { space: LockedSubspace; parentName: string }>(null);

  const close = () => setSwitcherOpen(false);
  useEscapeKey(close, isOpen);

  // Which branches are open. Every one starts shut each time the list is
  // shown — the list is the spaces you are in, and a branch opens only when
  // its chevron is pressed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Opening collapses every branch; closing clears the search and the branches
  // after the slide, so the list does not visibly reset on its way behind the
  // rail. Nothing takes focus — the panel opens as a list to read, and a
  // caret blinking in a box nobody asked to type in reads as a demand.
  useEffect(() => {
    if (isOpen) {
      setExpanded(new Set());
      return;
    }
    const t = setTimeout(() => { setQuery(''); setExpanded(new Set()); }, reduced ? 0 : DOCK_MS);
    return () => clearTimeout(t);
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
    const lockedOf = (id: string) => lockedSubspaces.filter((s) => s.parentId === id);
    const q = query.trim().toLowerCase();
    if (!q) {
      return spaceBranches([...joinedSpaces].sort((a, b) => a.name.localeCompare(b.name))).map((b) => ({
        ...b,
        locked: lockedOf(b.space.id),
      }));
    }
    return joinedSpaces
      .map((space) => ({ space, score: scoreName(space.name, q) }))
      .filter(({ score }) => score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .map(({ space }) => ({ space, children: [], locked: [] as typeof lockedSubspaces }));
  }, [joinedSpaces, lockedSubspaces, query]);

  // The branch holding the space you are in — itself, or its parent when you
  // stand in a sub-space. A search ranks everything as one list instead.
  const inHere = (r: (typeof rows)[number]) =>
    r.space.id === currentSpace?.id || r.children.some((c) => c.id === currentSpace?.id);
  const here = query.trim() ? [] : rows.filter(inHere);
  const elsewhere = query.trim() ? rows : rows.filter((r) => !inHere(r));

  const select = (spaceId: string) => {
    setCurrentSpace(spaceId);
    close();
  };

  const renderRow = ({ space, children, locked }: (typeof rows)[number]) => {
    // An admin's own space opens whether or not it has sub-spaces
    // yet: the branch is where they are read, so it is where the
    // first one is made. Spaces nest one level, so a sub-space
    // never offers it.
    const canAddSub = !space.parentId && manages(space.id);
    // A locked sub-space is a branch too: it is drawn precisely so
    // the chevron opens on a space whose only sub-spaces are ones
    // you are not in yet.
    const branches = children.length + locked.length + (canAddSub ? 1 : 0);
    const open = branches > 0 && expanded.has(space.id);
    return (
      <div key={space.id}>
        <SpaceListRow
          space={space}
          current={currentSpace?.id === space.id}
          hasChildren={branches > 0}
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
            <TreeSpine animate={!reduced} stem={railW / 2 - LIST_AVATAR_PX / 2}>
              {canAddSub && (
                <NewSubspaceRow
                  parentName={space.name}
                  nested={children.length === 0 ? 'last' : 'mid'}
                  tabbable={isOpen}
                  onClick={() => setCreating({ id: space.id, name: space.name })}
                />
              )}
              {children.map((child, i) => (
                <SubspaceRow
                  key={child.id}
                  space={child}
                  current={currentSpace?.id === child.id}
                  nested={i === children.length - 1 && locked.length === 0 ? 'last' : 'mid'}
                  tabbable={isOpen}
                  onSelect={() => select(child.id)}
                />
              ))}
              {/* The ones you cannot open, after the ones you can:
                  the branch reads as what is yours first, then what
                  is there to ask for. */}
              {locked.map((child, i) => (
                <LockedSubspaceRow
                  key={child.id}
                  space={child}
                  nested={i === locked.length - 1 ? 'last' : 'mid'}
                  tabbable={isOpen}
                  onSelect={() => setAsking({ space: child, parentName: space.name })}
                />
              ))}
            </TreeSpine>
          </div>
        )}
      </div>
    );
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
        <PanelSearch placeholder="Search spaces…" value={query} onChange={setQuery} tabbable={isOpen} />

        {/* Starting a space leads the list — the row you are looking for when
            none of the ones below is the one you want — then every space you
            are a member of, ranked by the search when there is
            one. A row with sub-spaces opens them under itself on its chevron:
            the spine drops out of the parent's avatar and ticks into each
            sub-space, ending at the last, so the branch reads as one drawing
            rather than an indent. */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3" style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
          <div style={{ marginBottom: ITEM_GAP }}>
            <NewSpaceRow tabbable={isOpen} onClick={() => setMakingSpace(true)} />
          </div>
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-text-muted">No spaces found</div>
          ) : (
            <>
              {/* The space you are in stands alone under New space, held off
                  the rest by the rail's hairline, so where you are reads first
                  and the others read as where you could go. */}
              {here.length > 0 && <div className="flex flex-col" style={{ gap: ITEM_GAP }}>{here.map(renderRow)}</div>}
              {elsewhere.length > 0 && (
                <div
                  className={`flex flex-col ${here.length > 0 ? 'border-t' : ''}`}
                  style={{ gap: ITEM_GAP, borderTopColor: 'var(--shell-border, #e5e7eb)' }}
                >
                  {elsewhere.map(renderRow)}
                </div>
              )}
            </>
          )}
        </div>
        {asking && (
          <RequestSubspaceAccessDialog
            space={asking.space}
            parentName={asking.parentName}
            onClose={() => setAsking(null)}
          />
        )}
        {(makingSpace || creating) && (
          <NewSpaceDialog
            parent={creating}
            onClose={() => { setCreating(null); setMakingSpace(false); }}
          />
        )}
      </aside>
  );
}
