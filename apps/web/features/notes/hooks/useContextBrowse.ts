'use client';

// Browsing state for the /context knowledge browser: the search box, the
// facet filters (tags, types, starred, connected-to) and the resulting note
// list, always sorted most-recently-updated first. One hook, one object, the same shape as
// useDirectoryBrowse — the filter bar takes the whole thing, the tree takes
// the items.
//
// Notes come in already loaded (useContextTree owns the fetch, because the
// docked sidebar renders the same tree), so everything here is derivation over
// that array plus one optional server call: a content search, which is the
// only question the note index can't answer locally.
//
// Facet semantics: OR within a facet, AND across facets. Everything is
// hydratable from `initial` so the page can restore a shared URL.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { humanizeFolderName, isIndexPath } from '@/lib/notes/shared/indexNote';
import type { NoteMeta } from '@/lib/notes/shared/types';
import type { SearchFilters } from '@/lib/notes/shared/retrieval';
import { notesApi } from '@/features/notes/lib/notesApi';

/** A note as the tree renders it — the index entry plus what it connects to. */
export interface ContextItem {
  path: string;
  title: string;
  /** Parent folder path; '' at the root. */
  folder: string;
  /** frontmatter.type, if the note declares one. */
  type: string | null;
  tags: string[];
  mtime: number;
  /** Resolved outgoing link targets (note paths). */
  linkTargets: string[];
  /** Link text that resolved to nothing — shown, greyed, as a dangling edge. */
  unresolved: string[];
  /** Notes that link here. */
  backlinkCount: number;
  /** Matching body text, when the hit came from the content search. */
  snippet?: string;
}

/** URL-restorable slice of the browse state. */
export interface ContextBrowseInitial {
  searchTerm?: string;
  filterTags?: string[];
  filterTypes?: string[];
  starredOnly?: boolean;
  connectedTo?: string | null;
  selectedPath?: string | null;
}

/** Below this a content search isn't worth a round trip — titles cover it. */
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * Every note as a browse item, index notes included, with backlink counts
 * resolved across the whole set. Pure so surfaces without the full browse state
 * (the connections rail on the note pages) derive the same items the browser
 * sees, from the same cached note list.
 */
export function toContextItems(notes: NoteMeta[]): ContextItem[] {
  const backlinks = new Map<string, number>();
  for (const note of notes) {
    for (const target of note.linkTargets ?? []) {
      backlinks.set(target, (backlinks.get(target) ?? 0) + 1);
    }
  }
  return notes.map((n) => ({
    path: n.path,
    title: n.title,
    folder: n.folder,
    type: typeof n.frontmatter?.type === 'string' ? n.frontmatter.type : null,
    tags: n.tags ?? [],
    mtime: n.mtime,
    linkTargets: n.linkTargets ?? [],
    unresolved: n.unresolved ?? [],
    backlinkCount: backlinks.get(n.path) ?? 0,
  }));
}

/**
 * Display title for a link target, which may be outside the filtered set.
 *
 * Index notes are folded into their folder everywhere else and are filtered out
 * of `items` entirely, so they're looked up in `titleByPath` — every note the
 * brain holds, including the indexes. That title IS the folder's name, so a link
 * to `communities/index.md` reads "Companies", the same as its tree row.
 */
export function titleOfPath(path: string, items: ContextItem[], titleByPath: Map<string, string>): string {
  const known = items.find((i) => i.path === path)?.title ?? titleByPath.get(path);
  if (known) return known;
  if (isIndexPath(path)) {
    const folder = path.split('/').slice(-2, -1)[0];
    return folder ? humanizeFolderName(folder) : 'Index';
  }
  return humanizeFolderName((path.split('/').pop() ?? path).replace(/\.md$/, ''));
}

function matchesText(item: ContextItem, query: string): boolean {
  return (
    item.title.toLowerCase().includes(query) ||
    item.path.toLowerCase().includes(query) ||
    item.tags.some((t) => t.toLowerCase().includes(query))
  );
}

export function useContextBrowse(
  notes: NoteMeta[],
  communityId: string | null,
  opts?: { starred?: string[]; initial?: ContextBrowseInitial },
) {
  const initial = opts?.initial;
  const starred = opts?.starred;
  const [searchTerm, setSearchTerm] = useState(initial?.searchTerm ?? '');
  const [filterTags, setFilterTags] = useState<Set<string>>(() => new Set(initial?.filterTags));
  const [filterTypes, setFilterTypes] = useState<Set<string>>(() => new Set(initial?.filterTypes));
  const [starredOnly, setStarredOnly] = useState(initial?.starredOnly ?? false);
  /** Scope the tree to the 1-hop link neighborhood of this note. Set from the
   *  focus panel's "show connections" action, cleared from its chip. */
  const [connectedTo, setConnectedTo] = useState<string | null>(initial?.connectedTo ?? null);
  /** Kept for compatibility with folder-scoped entry points; no UI sets it. */
  const [folder, setFolder] = useState<string | null>(null);
  /** The tree row the detail panel is showing. */
  const [selectedPath, setSelectedPath] = useState<string | null>(initial?.selectedPath ?? null);

  // Every note as a browse item, index notes included. The tree renders `items`
  // (below) instead, but anything that resolves a path — the selection, a link's
  // other end — has to see the indexes too, or a folder resolves to nothing.
  const allItems = useMemo<ContextItem[]>(() => toContextItems(notes), [notes]);

  // A folder's index note IS the folder as far as browsing goes (the tree shows
  // it as the folder row), so it never appears as a row of its own.
  const items = useMemo(() => allItems.filter((i) => !isIndexPath(i.path)), [allItems]);

  /** Path → item over ALL notes: selecting a folder selects its index note,
   *  which is exactly the path `items` drops. Resolve selections through this. */
  const itemByPath = useMemo(() => new Map(allItems.map((i) => [i.path, i])), [allItems]);

  const starredSet = useMemo(() => new Set(starred ?? []), [starred]);

  /** The 1-hop neighborhood of `connectedTo`: itself, its outgoing targets and
   *  every note that links to it. */
  const connectedSet = useMemo(() => {
    if (!connectedTo) return null;
    const set = new Set<string>([connectedTo]);
    for (const item of items) {
      if (item.path === connectedTo) for (const t of item.linkTargets) set.add(t);
      else if (item.linkTargets.includes(connectedTo)) set.add(item.path);
    }
    return set;
  }, [connectedTo, items]);

  const presentTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  const presentTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) if (item.type) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  // Content search: the local match covers titles, paths and tags instantly;
  // this covers note bodies, which only the server's index can see. Results are
  // merged in as extra hits (with their snippet), never as a replacement — a
  // title match must not disappear because the body ranked elsewhere.
  //
  // Server filters are narrower than the client facets (single type, AND-tags),
  // so only the unambiguous ones are forwarded: a tag or type only when exactly
  // one is selected. Anything wider stays client-side — over-restricting here
  // would silently drop body hits.
  const [bodyHits, setBodyHits] = useState<Map<string, string | undefined>>(new Map());
  const searchSeq = useRef(0);
  const serverFilters = useMemo<SearchFilters | undefined>(() => {
    const f: SearchFilters = {};
    if (filterTags.size === 1) f.tags = [...filterTags];
    if (filterTypes.size === 1) f.type = [...filterTypes][0];
    return Object.keys(f).length ? f : undefined;
  }, [filterTags, filterTypes]);
  useEffect(() => {
    const query = searchTerm.trim();
    if (!communityId || query.length < SEARCH_MIN_CHARS) {
      setBodyHits((prev) => (prev.size ? new Map() : prev));
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      notesApi
        .searchNotes(communityId, query, serverFilters ? { filters: serverFilters } : undefined)
        .then(({ results }) => {
          if (seq !== searchSeq.current) return;
          const next = new Map<string, string | undefined>();
          for (const r of results ?? []) if (r.kind === 'note') next.set(r.path, r.snippet);
          setBodyHits(next);
        })
        .catch(() => {
          if (seq === searchSeq.current) setBodyHits(new Map());
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchTerm, communityId, serverFilters]);

  const filteredItems = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    const scoped = items.filter((item) => {
      if (folder && !(item.path.startsWith(`${folder}/`) || item.folder === folder)) return false;
      if (filterTags.size && !item.tags.some((t) => filterTags.has(t))) return false;
      if (filterTypes.size && !(item.type && filterTypes.has(item.type))) return false;
      if (starredOnly && !starredSet.has(item.path)) return false;
      if (connectedSet && !connectedSet.has(item.path)) return false;
      if (!query) return true;
      return matchesText(item, query) || bodyHits.has(item.path);
    });

    const withSnippets = query
      ? scoped.map((item) =>
          bodyHits.get(item.path) && !matchesText(item, query)
            ? { ...item, snippet: bodyHits.get(item.path) }
            : item,
        )
      : scoped;

    const sorted = [...withSnippets];
    sorted.sort((a, b) => b.mtime - a.mtime);
    return sorted;
  }, [
    items, folder, filterTags, filterTypes, starredOnly, starredSet,
    connectedSet, searchTerm, bodyHits,
  ]);

  const clearFilters = useCallback(() => {
    setFilterTags(new Set());
    setFilterTypes(new Set());
    setStarredOnly(false);
    setConnectedTo(null);
  }, []);

  const activeCount =
    filterTags.size +
    filterTypes.size +
    (starredOnly ? 1 : 0) +
    (connectedTo ? 1 : 0);

  return {
    items,
    allItems,
    itemByPath,
    filteredItems,
    presentTags,
    presentTypes,
    searchTerm, setSearchTerm,
    filterTags, setFilterTags,
    filterTypes, setFilterTypes,
    starredOnly, setStarredOnly,
    connectedTo, setConnectedTo,
    folder, setFolder,
    selectedPath, setSelectedPath,
    activeCount,
    clearFilters,
  };
}
