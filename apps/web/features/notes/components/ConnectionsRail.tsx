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
import { useCommunity } from '@/features/shared/contexts/CommunityContext';
import { useContextPanel } from '@/features/shared/contexts/ContextPanelContext';
import { toContextItems, titleOfPath } from '@/features/notes/hooks/useContextBrowse';
import { useDirectoryEntities } from '@/features/notes/lib/useDirectoryEntities';
import { contextKeys, prefetchNoteContext, swrFetch } from '@/features/notes/lib/contextPrefetch';
import { notesApi } from '@/features/notes/lib/notesApi';
import { noteHref, resolveEntityNode } from '@/lib/notes/entities';
import { folderOfIndexPath, isIndexPath } from '@/lib/notes/shared/indexNote';
import { FilterDropdown } from '@/features/directory/components/FilterDropdown';
import { findNodeTypeConfig, getNodeTypeConfig } from '@/lib/types';
import { tagPalette } from '@/lib/tagColors';
import type { NoteMeta } from '@/lib/notes/shared/types';
import ContextLinksPanel from './ContextLinksPanel';

/** The rail's fixed width — what PaneSurfaceHost insets the note content by. */
export const CONNECTIONS_RAIL_W = 300;

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
  const { currentCommunity } = useCommunity();
  const communityId = currentCommunity?.id ?? null;
  const { setConnectionsOpen } = useContextPanel();
  const { entityByPath } = useDirectoryEntities();

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  // Re-run on path change too: a save that added a link invalidated the list
  // key, and landing on the linked note is exactly when it should be re-read.
  useEffect(() => {
    if (!communityId) return;
    let stale = false;
    swrFetch(contextKeys.list(communityId), () => notesApi.list(communityId), (l) => {
      if (!stale) setNotes(l.notes);
    }).catch(() => {});
    return () => { stale = true; };
  }, [communityId, path]);

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

  const nodeTypes = currentCommunity?.nodeTypes;
  const tagColors = currentCommunity?.designConfig?.tagColors ?? null;
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
      if (communityId) prefetchNoteContext(communityId, p);
      const targetId = resolveEntityNode(p, entityByPath);
      if (targetId) router.push(`/directory/${encodeURIComponent(targetId)}?tab=context`);
      else router.push(noteHref(p));
    },
    [communityId, entityByPath, path, router],
  );

  return (
    // Starts below the navbar (64px) plus the pinned tab row (48px) — the row
    // is opaque and stacked above (z-[45] on the note pages), so a rail that
    // reached up to the navbar would just hide its own header behind it. The
    // attached toolbar tray beside it is transparent; the tray recentres over
    // the narrowed column (PageTabBar insets by the rail width), so nothing
    // floats over the rail.
    <aside
      className={`fixed right-0 top-[112px] z-30 hidden h-[calc(100dvh-112px)] w-[300px] flex-col border-l border-border-subtle bg-surface-1 transition-transform duration-300 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)] motion-reduce:transition-none xl:flex ${
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
                  // Free-text frontmatter types read as the community console
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
  );
}
