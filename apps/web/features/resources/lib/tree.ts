import type { ResourceFolder } from '@/lib/types';

/**
 * Pure helpers over the flat folder list the API returns. The tree is small
 * enough that every question is answered by a walk.
 */

/** The folders from the root down to `folderId`, in order; empty at the root. */
export function folderTrail(folders: ResourceFolder[], folderId: string | null): ResourceFolder[] {
  const byId = new Map(folders.map(f => [f.id, f]));
  const trail: ResourceFolder[] = [];
  let cursor = folderId ? byId.get(folderId) : undefined;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    trail.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return trail;
}

/** `folderId` plus every folder beneath it — the set a folder may not move into. */
export function subtree(folders: ResourceFolder[], folderId: string): Set<string> {
  const ids = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return ids;
}

/** "Reports / 2026 / Q3" — where something sits, for search results and menus. */
export function folderPathLabel(folders: ResourceFolder[], folderId: string | null): string {
  const trail = folderTrail(folders, folderId);
  return trail.length ? trail.map(f => f.name).join(' / ') : 'Resources';
}

/** Folders under `parentId`, by name, case-insensitively. */
export function childFolders(folders: ResourceFolder[], parentId: string | null): ResourceFolder[] {
  return folders
    .filter(f => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
