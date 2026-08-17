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
// opening the rail costs no request when the cache is warm. The rail carries
// its own Type/Tag facets over the note's neighbourhood, feeding the panel's
// `keep` set; they reset per note.
//
// Unlike the browser, where clicking a connection re-selects it in place,
// clicking here NAVIGATES — this surface has no selection, the note page is the
// selection. Entity notes go to their profile's Context tab, plain notes to
// their own note view: the same rule the docked tree and the note body follow.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { CONNECTIONS_RAIL_W, useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { SHELL_FRAME_GAP, SHELL_FRAME_MARGIN, SHELL_FRAME_RADIUS } from '@/features/shared/contexts/ThemeContext';
import { toContextItems, titleOfPath } from '@/features/notes/lib/contextItems';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { contextKeys, prefetchNoteContext, swrFetch } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import { hrefForNotePath } from '@/lib/notes/entities';
import { folderOfIndexPath, isIndexPath } from '@/lib/notes/shared/indexNote';
import { FilterDropdown } from '@/features/directory/components/FilterDropdown';
import { findNodeTypeConfig, getNodeTypeConfig } from '@/lib/types';
import { tagPalette } from '@/lib/tagColors';
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
  const { setConnectionsOpen, dockTopInset } = useContextPanel();
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

  // The rail's own facets — scoped to THIS note's neighbourhood, independent of
  // the 3-column browser's toolbar. Options come from the connections actually
  // on screen, so the menus never offer a type or tag that can't match. Reset
  // per note: a facet chosen for one note's neighbourhood is noise on the next.
  const [filterTypes, setFilterTypes] = useState<Set<string>>(() => new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setFilterTypes(new Set());
    setFilterTags(new Set());
  }, [path]);

  // Every note on the other end of a connection (out, in, or both).
  const connectedItems = useMemo(() => {
    if (!item) return [];
    const paths = new Set(item.linkTargets);
    for (const other of allItems) {
      if (other.path !== item.path && other.linkTargets.includes(item.path)) paths.add(other.path);
    }
    paths.delete(item.path);
    return allItems.filter((i) => paths.has(i.path));
  }, [item, allItems]);

  const nodeTypes = currentSpace?.nodeTypes;
  const tagColors = currentSpace?.designConfig?.tagColors ?? null;
  const presentTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of connectedItems) if (i.type) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [connectedItems]);
  const presentTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of connectedItems) for (const t of i.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [connectedItems]);

  // What survives the facets, in the shape ContextLinksPanel prunes by: note
  // paths, except index notes which it judges by their FOLDER (the folder IS
  // the index). OR within a facet, AND across — the browser's semantics.
  const keep = useMemo(() => {
    if (filterTypes.size === 0 && filterTags.size === 0) return null;
    const set = new Set<string>();
    for (const i of connectedItems) {
      if (filterTypes.size && !(i.type && filterTypes.has(i.type))) continue;
      if (filterTags.size && !i.tags.some((t) => filterTags.has(t))) continue;
      set.add(isIndexPath(i.path) ? folderOfIndexPath(i.path) : i.path);
    }
    return set;
  }, [filterTypes, filterTags, connectedItems]);
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
    // The rail lives INSIDE the shell's rounded content card, not at the screen
    // edge: the clip wrapper pins to the card's right region — below the navbar
    // (64px) plus the frame gap, and inset from the viewport right/bottom by the
    // card's own inset (SHELL_FRAME_MARGIN + SHELL_FRAME_GAP). Its
    // overflow-hidden is what makes the slide emerge from the card's edge
    // rather than the side of the screen, and it carries the card's right-hand
    // corner radii so the rail doesn't poke square corners past the frame.
    //
    // It starts below the pane's pinned tab row (dockTopInset): the row is the
    // surface's chrome and belongs across the whole card, so nothing about the
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
      className={`pointer-events-auto flex h-full w-full flex-col border-l border-border-subtle bg-surface-1 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none ${
        slidIn ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label="Connections"
      aria-hidden={!open}
    >
      <div className="shrink-0 border-b border-border-subtle px-4 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Connections</span>
          <button
            type="button"
            onClick={() => setConnectionsOpen(false)}
            aria-label="Close connections"
            className="rounded-md p-1 text-text-muted transition hover:bg-surface-2 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {(presentTypes.length > 0 || presentTags.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {presentTypes.length > 0 && (
              <FilterDropdown
                compact
                label="Type"
                options={presentTypes.map(([type, count]) => ({
                  value: type,
                  // Free-text frontmatter types read as the space console
                  // names them whenever the value resolves to a real type.
                  label: findNodeTypeConfig(type, nodeTypes)?.name ?? type,
                  count,
                }))}
                selected={filterTypes}
                onChange={setFilterTypes}
                getColor={(type) => getNodeTypeConfig(type, nodeTypes).color}
              />
            )}
            {presentTags.length > 0 && (
              <FilterDropdown
                compact
                label="Tag"
                options={presentTags.map(([tag, count]) => ({ value: tag, label: tag, count }))}
                selected={filterTags}
                onChange={setFilterTags}
                getColor={(tag) => tagPalette(tag, tagColors).base}
              />
            )}
            {(filterTypes.size > 0 || filterTags.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  setFilterTypes(new Set());
                  setFilterTags(new Set());
                }}
                className="text-[13px] font-medium text-text-muted transition-colors hover:text-text-secondary"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ContextLinksPanel
          item={item}
          items={allItems}
          titleFor={titleFor}
          keep={keep}
          aliasOfPath={aliasOfPath}
          onSelectPath={openPath}
        />
      </div>
    </aside>
    </div>
  );
}
