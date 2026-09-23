// The Directory's views, as one list and one href builder.
//
// Two surfaces put these tabs in the pane bar — the Directory page itself and
// any context note under it — and they have to agree on the order and on where
// each tab goes, so both read them from here rather than each keeping a copy.
//
// Context is second, beside Grid: Grid and Context are the two ways to arrive
// at a record (its card, its note), and Table is the one that needs a type
// chosen first. Resources is last: not records but everything unstructured the
// space holds — files and links, wherever they were shared.
//
// **The type travels with the view.** `?type=` is the Table's per-type tab, and
// carrying it through Grid — which ignores it — is what makes
// leaving the Table and coming back land where it was left. From a context note
// the type is the note's own namespace (`people/craig/index.md` → person), so
// crossing to the Table from what you were reading opens that type's table
// rather than the first one.
//
// Pure — no React, no DOM. `tests/directory-views.test.ts` covers it.

export type DirectoryView = 'grid' | 'table' | 'resources'

/** A pane-bar tab, structurally the shell's `PaneTabItem`. */
export interface DirectoryTab {
  id: string
  label: string
}

/** The context root's note. Selecting Context navigates here, not to a `?view=`. */
export const CONTEXT_TAB_ID = 'context'

export function directoryTabs(): DirectoryTab[] {
  return [
    { id: 'grid', label: 'Grid' },
    { id: CONTEXT_TAB_ID, label: 'Context' },
    { id: 'table', label: 'Table' },
    { id: 'resources', label: 'Resources' },
  ]
}

export function isDirectoryView(id: string): id is DirectoryView {
  return id === 'grid' || id === 'table' || id === 'resources'
}

/**
 * Where a view tab goes. The type rides along when there is one — a table
 * needs it, the grid keeps it so the round trip remembers.
 */
export function directoryViewHref(view: DirectoryView, type?: string | null): string {
  const params = new URLSearchParams()
  if (view !== 'grid') params.set('view', view)
  const t = (type ?? '').trim().toLowerCase()
  if (t) params.set('type', t)
  const query = params.toString()
  return query ? `/directory?${query}` : '/directory'
}

/** Where `/resources` lands: the Resources tab. */
export const RESOURCES_HREF = directoryViewHref('resources')
