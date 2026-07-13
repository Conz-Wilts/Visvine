// Pure parser for the directory's ?view= URL param — the single source of
// truth for which directory surface is active. Junk values fall back to the
// grid.

export type DirectoryView = 'grid' | 'table' | 'graph';

const VIEWS: readonly DirectoryView[] = ['grid', 'table', 'graph'];

export function parseDirectoryView(raw: string | null | undefined): DirectoryView {
  return VIEWS.find((v) => v === raw) ?? 'grid';
}
