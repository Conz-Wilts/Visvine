import { fetchJson } from '@/lib/fetchJson';
import type { ResourceFolder } from '@/lib/types';

const json = (method: 'POST' | 'PATCH', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** The Drive's write calls, in one place so the page and its menus agree on them. */
export const driveApi = {
  /** Uploads one file into a folder (`null` for the root). */
  async upload(spaceId: string, file: File, folderId: string | null): Promise<void> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('spaceId', spaceId);
    if (folderId) fd.append('folderId', folderId);
    const res = await fetch('/api/resources/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? 'Upload failed');
    }
  },
  createFolder(spaceId: string, name: string, parentId: string | null) {
    return fetchJson<ResourceFolder>('/api/resources/folders', json('POST', { spaceId, name, parentId }));
  },
  renameFolder(id: string, name: string) {
    return fetchJson(`/api/resources/folders/${encodeURIComponent(id)}`, json('PATCH', { name }));
  },
  moveFolder(id: string, parentId: string | null) {
    return fetchJson(`/api/resources/folders/${encodeURIComponent(id)}`, json('PATCH', { parentId }));
  },
  deleteFolder(id: string) {
    return fetchJson(`/api/resources/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  renameFile(id: string, name: string) {
    return fetchJson(`/api/resources/${encodeURIComponent(id)}`, json('PATCH', { name }));
  },
  moveFile(id: string, folderId: string | null) {
    return fetchJson(`/api/resources/${encodeURIComponent(id)}`, json('PATCH', { folderId }));
  },
  deleteFile(id: string) {
    return fetchJson(`/api/resources?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
