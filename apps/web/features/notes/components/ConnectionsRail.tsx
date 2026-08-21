'use client';

// The connections pillar as a standalone right-hand rail for the note surfaces
// (/directory/note/<path> and the profile Context tab): the same
// ContextLinksPanel the 3-column browser shows, minus the browser around it.
// Toggled from the note toolbar (connectionsOpen in ContextPanelContext) and
// mounted once by PaneSurfaceHost, so it rides across note→note and
// note↔entity navigation without remounting.
//
// Everything derives from the cached note list (contextKeys.list) — the same
// key the panels themselves read, kept fresh by every save's invalidation — so
// opening the rail costs no request when the cache is warm.
//
// Unlike the browser, where clicking a connection re-selects it in place,
// clicking here NAVIGATES — this surface has no selection, the note page is the
// selection. Entity notes go to their profile's Context tab, plain notes to
// their own note view: the same rule the docked tree and the note body follow.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { CONNECTIONS_RAIL_W, useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS } from '@/features/shared/contexts/ThemeContext';
import { toContextItems, titleOfPath } from '@/features/notes/lib/contextItems';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { contextKeys, prefetchNoteContext, swrFetch } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import { hrefForNotePath } from '@/lib/notes/entities';
import type { NoteMeta } from '@/lib/notes/shared/types';
import ContextLinksPanel from './ContextLinksPanel';

export default function ConnectionsRail({ path, open }: { path: string | null; open: boolean }) {
  const router = useRouter();

  // The slide. The rail mounts closed (offscreen right) and flips to open on
  // the next frame, so the first paint and the slid-in state are separated and
  // the transform genuinely transitions — mounting straight into the open
  // class would just appear in place. Closing flips it back; the host keeps
  // the rail mounted until the slide-out has played.
  const [slidIn, setSlidIn] = useState(false);
  useEffect(() => {
    if (!open) {
      setSlidIn(false);
      return;
    }
    const raf = requestAnimationFrame(() => setSlidIn(true));
    return () => cancelAnimationFrame(raf);
  }, [open]);
  const { currentSpace } = useSpace();
  const spaceId = currentSpace?.id ?? null;
  // The pane tab row's height while one is up (PaneShell publishes it). The rail
  // hangs BELOW that row — the bar keeps the full width of the card — so the
  // rail's own top starts at the row's bottom edge.
  const { dockTopInset } = useContextPanel();
  const { entityByPath } = useDirectoryEntities();

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  // Re-run on path change too: a save that added a link invalidated the list
  // key, and landing on the linked note is exactly when it should be re-read.
  useEffect(() => {
    if (!spaceId) return;
    let stale = false;
    swrFetch(contextKeys.list(spaceId), () => notesApi.list(spaceId), (l) => {
      if (!stale) setNotes(l.notes);
    }).catch(() => {});
    return () => { stale = true; };
  }, [spaceId, path]);

  const allItems = useMemo(() => toContextItems(notes), [notes]);
  const item = useMemo(
    () => (path ? allItems.find((i) => i.path === path) ?? null : null),
    [allItems, path],
  );
  const titleByPath = useMemo(() => new Map(notes.map((n) => [n.path, n.title])), [notes]);

  const titleFor = useCallback(
    (target: string) => titleOfPath(target, allItems, titleByPath),
    [allItems, titleByPath],
  );
  const aliasOfPath = useCallback(
    (p: string) => entityByPath.get(p)?.alias ?? null,
    [entityByPath],
  );

  const openPath = useCallback(
    (p: string) => {
      if (p === path) return;
      if (spaceId) prefetchNoteContext(spaceId, p);
      router.push(hrefForNotePath(p, entityByPath));
    },
    [spaceId, entityByPath, path, router],
  );

  return (
    // The rail lives inside the shell's content surface: the clip wrapper pins
    // to the surface's right region — below the navbar (64px) and aligned to
    // the surface's edges via the SHELL_FRAME_* constants. Its overflow-hidden
    // is what makes the slide emerge from the surface's edge rather than the
    // side of the screen.
    //
    // It starts below the pane's pinned tab row (dockTopInset): the row is the
    // surface's chrome and belongs across the whole surface, so nothing about the
    // rail narrows it — the rail simply hangs under it. The note BODY does make
    // room (PaneSurfaceHost pads its content by the rail's width); the shell's
    // <main> deliberately does not, so the row and the navbar seam it continues
    // stay put when the rail opens.
    //
    // pointer-events-none so the transparent wrapper never swallows clicks;
    // the aside re-enables them on itself.
    <div
      className="pointer-events-none fixed z-30 hidden overflow-hidden xl:block"
      style={{
        top: 64 + SHELL_FRAME_GAP + dockTopInset,
        right: SHELL_FRAME_MARGIN + SHELL_FRAME_GAP,
        bottom: SHELL_FRAME_MARGIN + SHELL_FRAME_GAP,
        width: CONNECTIONS_RAIL_W,
        // Only when it actually reaches the card's own top corner — under a tab
        // row it sits mid-edge, where a radius would round nothing.
        borderTopRightRadius: dockTopInset > 0 ? 0 : SHELL_FRAME_RADIUS,
        borderBottomRightRadius: SHELL_FRAME_RADIUS,
      }}
    >
    <aside
      className={`pointer-events-auto flex h-full w-full flex-col bg-surface-1 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none ${
        slidIn ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label="Connections"
      aria-hidden={!open}
    >
      <div className="min-h-0 flex-1">
        <ContextLinksPanel
          item={item}
          items={allItems}
          titleFor={titleFor}
          aliasOfPath={aliasOfPath}
          onSelectPath={openPath}
        />
      </div>
    </aside>
    </div>
  );
}
