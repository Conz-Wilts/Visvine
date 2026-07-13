// Pure parser for the directory's ?view= URL param — the single source of
// truth for which of the four directory surfaces is active. Junk values fall
// back to the grid, and the context view is only reachable while the community
// has the notes tool enabled.

export type DirectoryView = 'grid' | 'table' | 'graph' | 'context';

const VIEWS: readonly DirectoryView[] = ['grid', 'table', 'graph', 'context'];

export function parseDirectoryView(raw: string | null | undefined, notesEnabled: boolean): DirectoryView {
  const view = VIEWS.find((v) => v === raw) ?? 'grid';
  if (view === 'context' && !notesEnabled) return 'grid';
  return view;
}
