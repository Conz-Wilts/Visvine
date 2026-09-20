/**
 * What a profile section can be — the one table that says so.
 *
 * A member builds their own profile out of sections: they name one
 * ("Education", "Writing", "Portfolio") and pick what shape it holds. The
 * shape is the only thing the platform decides; the name is theirs.
 *
 *   text      one prose body on the section, no rows
 *   list      rows of a title and a note
 *   timeline  rows of a title, who it was with, and the years
 *   links     rows of a label and a URL
 *
 * A kind names the FIELDS its rows use; every other column is left null and is
 * dropped on the way in, so changing a section's kind can never resurrect a
 * value the new shape does not draw. Two fields belong to every kind and to no
 * kind's list — a row may carry a picture, and a row may point at a space —
 * because those are ways of drawing a row, not what a row is about.
 *
 * Pure, React-free and a dependency leaf: the routes, the editor and the page
 * all read this one table.
 */

/** The shapes a section can hold. */
export type SectionKind = 'text' | 'list' | 'timeline' | 'links';

/** A row's own fields, named by the kind that uses them. */
export type EntryField = 'title' | 'subtitle' | 'description' | 'url' | 'startYear' | 'endYear';

export interface SectionKindRow {
  kind: SectionKind;
  /** What the kind is called where one is chosen. */
  label: string;
  /** True when the section itself holds the prose and has no rows. */
  body: boolean;
  /** The row fields this kind draws, in the order the editor asks for them. */
  fields: EntryField[];
  /** What adding a row is called. */
  addLabel: string;
}

export const SECTION_KINDS: readonly SectionKindRow[] = [
  { kind: 'text', label: 'Text', body: true, fields: [], addLabel: 'Add' },
  { kind: 'list', label: 'List', body: false, fields: ['title', 'description'], addLabel: 'Add item' },
  {
    kind: 'timeline',
    label: 'Timeline',
    body: false,
    fields: ['title', 'subtitle', 'startYear', 'endYear', 'description'],
    addLabel: 'Add entry',
  },
  { kind: 'links', label: 'Links', body: false, fields: ['title', 'url'], addLabel: 'Add link' },
] as const;

/** Fields every kind carries: how a row is drawn, not what it says. */
const UNIVERSAL_ENTRY_FIELDS = ['imageUrl', 'spaceId'] as const;

/** How many sections one profile may hold, and how many rows one section may. */
export const MAX_SECTIONS = 12;
export const MAX_ENTRIES = 50;
export const MAX_TITLE = 60;

export function isSectionKind(value: unknown): value is SectionKind {
  return typeof value === 'string' && SECTION_KINDS.some((row) => row.kind === value);
}

/** The row for a kind; an unknown kind reads as `list`, the plainest shape. */
export function kindOf(kind: string): SectionKindRow {
  return SECTION_KINDS.find((row) => row.kind === kind) ?? SECTION_KINDS[1];
}

export const fieldsFor = (kind: string): EntryField[] => kindOf(kind).fields;
export const hasBody = (kind: string): boolean => kindOf(kind).body;

export interface EntryValues {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  url?: string | null;
  startYear?: string | null;
  endYear?: string | null;
  imageUrl?: string | null;
  spaceId?: string | null;
}

/**
 * The row as this kind holds it: the fields the kind draws, plus the two every
 * kind carries. What the kind does not draw is nulled rather than dropped, so a
 * section that changes shape stops showing the old values in the same write.
 */
export function normalizeEntry<T extends EntryValues>(kind: string, entry: T): EntryValues {
  const drawn = new Set<string>(fieldsFor(kind));
  const out: EntryValues = {};
  for (const field of ['title', 'subtitle', 'description', 'url', 'startYear', 'endYear'] as const) {
    if (field in entry) out[field] = drawn.has(field) ? (entry[field] ?? null) : null;
  }
  for (const field of UNIVERSAL_ENTRY_FIELDS) {
    if (field in entry) out[field] = entry[field] ?? null;
  }
  return out;
}

/**
 * The order a section's rows are drawn in: what the member arranged, and for a
 * timeline the later year first when two rows sit at the same place — a
 * timeline reads newest first the way every other one does.
 */
export function sortEntries<T extends { position: number; startYear?: string | null; endYear?: string | null }>(
  kind: string,
  entries: readonly T[],
): T[] {
  const timeline = kindOf(kind).kind === 'timeline';
  return [...entries].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    if (!timeline) return 0;
    const at = a.endYear ?? a.startYear ?? '';
    const bt = b.endYear ?? b.startYear ?? '';
    return bt.localeCompare(at);
  });
}

/** A title fit to store: trimmed, capped, never empty. */
export function cleanTitle(raw: string, fallback = 'Section'): string {
  const trimmed = raw.trim().slice(0, MAX_TITLE);
  return trimmed || fallback;
}

/**
 * The positions a reorder writes: the ids the member arranged, in order, with
 * anything they did not name kept behind them in the order it already had. An
 * id that is not theirs is ignored, so a stale client cannot move a row it
 * never saw.
 */
export function applyOrder(order: readonly string[], existing: readonly string[]): string[] {
  const known = new Set(existing);
  const named = order.filter((id) => known.has(id));
  const seen = new Set(named);
  return [...named, ...existing.filter((id) => !seen.has(id))];
}
