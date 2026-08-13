// Pure derivations over the cached note list, shared by the surfaces that show
// a note's connections (the ConnectionsRail on note pages and its links panel).
// Notes come in already loaded — useContextTree owns the fetch.

import { humanizeFolderName, isIndexPath } from '@/lib/notes/shared/indexNote';
import type { NoteMeta } from '@/lib/notes/shared/types';

/** A note as the connections surfaces render it — the index entry plus what it connects to. */
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

/**
 * Every note as a browse item, index notes included, with backlink counts
 * resolved across the whole set. Pure, so every surface derives the same items
 * from the same cached note list.
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
 * Index notes are folded into their folder everywhere else, so they're looked
 * up in `titleByPath` — every note the context holds, including the indexes. That
 * title IS the folder's name, so a link to `communities/index.md` reads
 * "Companies", the same as its tree row.
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
