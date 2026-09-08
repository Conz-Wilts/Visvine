'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateModal } from '@/features/shared/contexts/CreateModalContext';
import { useSidebar } from '@/features/shared/contexts/SidebarContext';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { useHoverIntent } from '@/features/shared/hooks/useHoverIntent';
import { useSession } from '@/features/auth/lib/auth-client';
import { CompassIcon, SettingsIcon } from '@/features/shared/icons';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { spaceMark } from '@/lib/spaces/subspaces';
import { HEAD_CELL_W, ITEM_GAP, ROW_H, ROW_INSET, Row } from '@/features/shared/components/layout/railRow';

/**
 * The space band — the rail's first rows (Sidebar). The space sits at the head
 * of the same column you sit at the foot of, and it opens the same way the
 * account band does: point at the space and the band GROWS DOWNWARD. What
 * hangs off the space — Discover, and the console for admins —
 * unfolds as ordinary rail rows on the rail's own glyph column,
 * their names arriving on the same fade the tools' names do. Opening the space
 * is the rail widening and the band unfolding, one gesture, rather than a panel
 * appearing over whatever page you were reading.
 *
 * The space's own row IS the switcher: pointing at it slides the search and
 * the list of every space you are in out beside the rail, because going
 * somewhere else is what the head of the rail is most often for. Pointing at
 * any row of the band below puts the list away. The band's rows are the rest.
 *
 * Discover leads the band: it is a way OUT of this space, not one of the
 * create-panel's kinds. Starting a space is the switcher's own last row —
 * it belongs beside the spaces you are already in.
 */
export default function SpaceSelector() {
  const { currentSpace, spaces, isAdmin } = useSpace();
  const { expanded, reduced, switcherOpen, setSwitcherOpen, setAccountPanel } = useSidebar();
  // The switcher and Create new share the rail's edge, one at a time.
  const { close: closeCreate } = useCreateModal();
  const { data: session } = useSession();
  const router = useRouter();
  // The console is the space's own settings, so it hangs off the space — not
  // off a rail row of its own. Same gate the console page applies.
  const canManage = Boolean(currentSpace) && (isAdmin || session?.user?.isSuperAdmin === true);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  // A band row puts the switcher away only once the pointer has rested on it:
  // the pointer heading right, out of the space's row and into the list, may
  // cross a row of the band on its way.
  const intent = useHoverIntent();
  const bandRef = useRef<HTMLDivElement>(null);
  // A pinned band closes on the next click outside it, the way the account
  // band does. Hover-opened bands need nothing: the pointer leaving closes them.
  useEffect(() => {
    if (!pinned) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (bandRef.current?.contains(e.target as Node)) return;
      setPinned(false);
      setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [pinned]);

  // The rail shutting takes the band with it: a column of nameless glyphs
  // under the avatar is not a menu anyone can read.
  useEffect(() => {
    if (!expanded) {
      setOpen(false);
      setPinned(false);
    }
  }, [expanded]);

  // The switcher itself is the rail's panel (SpaceSwitcherPanel), slid out
  // beside the rail by the Sidebar; this only asks for it. Create new shares
  // the rail's edge, so it goes away first.
  const openSwitcher = () => {
    closeCreate();
    setAccountPanel(null);
    setSwitcherOpen(true);
  };

  // The list is open only while the pointer is on the space (or in the list
  // itself): pointing at any row of the band puts it away.
  const shutSwitcher = () => setSwitcherOpen(false);
  const actions: { key: string; label: string; onClick: () => void; onHover: () => void; icon: React.ReactNode }[] = [
    // Discover leads the band: leaving this space for another is the same
    // question the switcher under the pointer is asking, so it belongs beside
    // the spaces you are already in rather than among the tools below.
    {
      key: 'discover',
      label: 'Discover',
      onClick: () => router.push('/discover'),
      onHover: shutSwitcher,
      icon: <CompassIcon />,
    },
    ...(canManage
      ? [
          {
            key: 'console',
            label: 'Space console',
            onClick: () => router.push('/admin'),
            onHover: shutSwitcher,
            icon: <SettingsIcon />,
          },
        ]
      : []),
  ];

  // A sub-space wears its parent's mark (spaceMark), so the head row says
  // which space you are in with the picture and WHERE by the parent's name
  // under it — the sub-space's own name is the only thing that differs.
  const mark = currentSpace ? spaceMark(currentSpace, spaces) : null;
  const parentName = currentSpace?.parentId
    ? (spaces.find((s) => s.id === currentSpace.parentId)?.name ?? null)
    : null;

  // The sheet is the hairline under the space's row and everything it
  // reveals. Shut, it is one gap tall — the rail's rhythm between the space
  // and Create — with the hairline along its bottom edge, which is the line
  // between the two. Open, it grows by the rows, a gap above each and one
  // below, and that same line is what travels down over the rows it covers.
  const shutH = ITEM_GAP;
  const openH = shutH + actions.length * ROW_H + (actions.length + 1) * ITEM_GAP;
  const dur = reduced ? '0s' : '260ms';

  return (
    <div
      ref={bandRef}
      className="relative flex flex-col"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!pinned) setOpen(false); }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => {
        if (pinned) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOpen(false);
      }}
    >
      {/* The space. A rail row: the avatar centred in the rail's glyph cell,
          then the space's name, which the collapsed rail clips away. Pointing
          at it opens the band below AND slides the switcher out beside the
          rail; pressing it toggles the switcher. */}
      <div style={{ paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}>
        <button
          type="button"
          onMouseEnter={openSwitcher}
          onClick={() => (switcherOpen ? setSwitcherOpen(false) : openSwitcher())}
          aria-haspopup="dialog"
          aria-expanded={switcherOpen}
          className={`relative z-10 flex w-full items-center transition-colors duration-150 hover:bg-surface-3 ${
            switcherOpen ? 'bg-surface-3' : ''
          }`}
          style={{ height: ROW_H }}
        >
          <span className="flex shrink-0 items-center justify-center" style={{ width: HEAD_CELL_W, height: ROW_H }}>
            {currentSpace && mark ? (
              <SpaceAvatar name={mark.name} imageUrl={mark.imageUrl} size="md" rounded="rounded-[10px]" className="!w-10 !h-10 !text-base" />
            ) : (
              <div className="w-10 h-10 rounded-[10px] bg-surface-3 flex-shrink-0" />
            )}
          </span>
          {/* The name stays mounted so it can FADE with the rail's other labels
              but is transparent and untouchable while the rail is shut. */}
          <span
            aria-hidden={!expanded}
            className="ml-2 flex min-w-0 flex-1 items-center"
            style={{
              opacity: expanded ? 1 : 0,
              pointerEvents: expanded ? undefined : 'none',
              transition: reduced ? 'none' : `opacity 140ms ease ${expanded ? 200 : 0}ms`,
            }}
          >
            <span className="flex min-w-0 flex-1 flex-col text-left">
              <span className="min-w-0 truncate text-[15px] font-open-sauce font-semibold text-text-primary">
                {currentSpace?.name || 'Select space'}
              </span>
              {parentName && (
                <span className="min-w-0 truncate text-[13px] font-open-sauce text-text-muted">{parentName}</span>
              )}
            </span>
          </span>
        </button>
      </div>

      {/* The sheet. Unlike the account band — which grows into the empty air
          above the avatar — this one LAYS OVER the rows beneath it rather than
          pushing them down: absolutely positioned from the foot of the space's
          row, painted opaque, so Create and the tools hold still while it
          unfolds across them. It starts at the row's foot rather than at the
          line so the pointer never leaves the band on its way down to a row —
          the gap is part of the sheet. Clipped rather than unmounted so the
          stack is there to travel, and the labels fade on the rail's timing. */}
      <div
        className="absolute left-0 right-0 z-20 overflow-hidden border-b"
        style={{
          top: ROW_H,
          height: open ? openH : shutH,
          // The sheet's bottom edge is the rail's one hairline: the line under
          // the space when shut, and the edge seen travelling down over the
          // rows when open.
          borderBottomColor: 'var(--shell-border, #e5e7eb)',
          boxSizing: 'content-box',
          // The rail paints nothing of its own (--shell-bg is transparent),
          // so the sheet is painted in the page's backdrop, which is what the
          // rows beneath it sit on.
          background: 'var(--app-backdrop, #ffffff)',
          transition: reduced ? 'none' : `height ${dur} cubic-bezier(0.25, 0.1, 0.25, 1)`,
        }}
        aria-hidden={!open}
      >
        <div
          className="flex flex-col"
          // Two gaps above the first row: the one the shut sheet already is,
          // then one holding the row off the line.
          style={{ gap: ITEM_GAP, paddingTop: ITEM_GAP * 2, paddingBottom: ITEM_GAP, paddingLeft: ROW_INSET, paddingRight: ROW_INSET }}
        >
          {actions.map(({ key, label, icon, onClick, onHover }) => (
            <div key={key} {...intent(onHover)}>
              <Row
                expanded={expanded}
                reduced={reduced}
                label={label}
                icon={icon}
                onClick={() => {
                  setPinned(false);
                  setOpen(false);
                  onClick();
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
