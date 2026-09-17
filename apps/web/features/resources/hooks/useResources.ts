'use client';
import { useState, useEffect } from 'react';
import type { Resource, ResourceFolder } from '@/lib/types';
import { fetchJson } from '@/lib/fetchJson';
import { swrFetch } from '@/features/shared/lib/requestCache';

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
  }, [spaceId]);

  return { resources, folders, loading, error };
}
