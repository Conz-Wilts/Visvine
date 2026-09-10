'use client';
import { useState, useEffect, useCallback } from 'react';
import type { Resource, ResourceFolder } from '@/lib/types';
import { fetchJson } from '@/lib/fetchJson';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';

const driveKeys = {
  files: (spaceId: string) => `drive:files:${spaceId}`,
  folders: (spaceId: string) => `drive:folders:${spaceId}`,
};

interface Drive {
  resources: Resource[];
  folders: ResourceFolder[];
}

function loadDrive(spaceId: string, onData: (drive: Partial<Drive>) => void): Promise<Drive> {
  return Promise.all([
    swrFetch(driveKeys.files(spaceId), () => fetchJson<Resource[]>(`/api/resources?space_id=${spaceId}`), (resources) =>
      onData({ resources }),
    ),
    swrFetch(driveKeys.folders(spaceId), () => fetchJson<ResourceFolder[]>(`/api/resources/folders?space_id=${spaceId}`), (folders) =>
      onData({ folders }),
    ),
  ]).then(([resources, folders]) => ({ resources, folders }));
}

/** Forget a space's Drive listing, so the next reader fetches it afresh. A
 *  write that changed the Drive (upload, rename, delete) calls this before
 *  `refetch`; a reader that merely re-mounts paints from the cache. */
function invalidateDrive(spaceId: string) {
  invalidateRequestCache(driveKeys.files(spaceId), driveKeys.folders(spaceId));
}

/**
 * A space's Drive: every file and every folder, fetched together so the tree
 * and its contents never disagree on screen. Read through the shared request
 * cache: a tab toggle or a back-navigation paints the last listing at once and
 * revalidates behind it, and two surfaces mounting together share one request.
 */
export function useResources(spaceId: string | null) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [folders, setFolders] = useState<ResourceFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // A write's `refetch` drops the cache first; a mount's load goes through it.
  const refetch = useCallback(async () => {
    if (!spaceId) return;
    invalidateDrive(spaceId);
    setVersion((v) => v + 1);
  }, [spaceId]);

  useEffect(() => {
    if (!spaceId) { setResources([]); setFolders([]); return; }
    let live = true;
    setLoading(true);
    setError(null);
    loadDrive(spaceId, (part) => {
      if (!live) return;
      if (part.resources) setResources(part.resources);
      if (part.folders) setFolders(part.folders);
    })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'Unknown error');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => { live = false; };
  }, [spaceId, version]);

  return { resources, folders, loading, error, refetch };
}
