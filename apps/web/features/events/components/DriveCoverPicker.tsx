'use client';

/**
 * Pick an event's poster from a picture the space already holds.
 *
 * The Drive is where the flyer usually is by the time anyone opens the
 * composer, and re-downloading it to re-upload it is a step nobody should have
 * to take. Choosing here posts the file's id — never its bytes and never its
 * signed URL — to the event's cover route, which copies it inside the space
 * (lib/events/cover.ts). It is the same call the MCP create_event tool makes
 * with `cover_resource_id`, so a person and an agent set a cover the same way.
 */

import { useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { Alert } from '@/components/ui';
import { fetchJsonBody } from '@/lib/fetchJson';
import { useResources } from '@/features/resources/hooks/useResources';
import { FolderIcon, LoaderCircleIcon, SearchIcon } from '@/features/shared/icons';
import type { NBEvent } from '@/lib/types';

interface Props {
  spaceId: string;
  eventId: string;
  onClose: () => void;
  /** The saved event, so the composer can take the cover URL it now carries. */
  onPicked: (event: NBEvent) => void;
}

export function DriveCoverPicker({ spaceId, eventId, onClose, onPicked }: Props) {
  // The same Drive listing the Resources tab holds, through the same cache —
  // opening the picker after browsing the Drive costs no request.
  const { resources, folders, loading, error: driveError } = useResources(spaceId);
  const images = useMemo(
    () => (loading && resources.length === 0 ? null : resources.filter((f) => f.fileType === 'image')),
    [loading, resources],
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);

  const folderName = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !images) return images ?? [];
    return images.filter((f) => f.name.toLowerCase().includes(q));
  }, [images, query]);

  const pick = async (resourceId: string) => {
    setError(null);
    setApplying(resourceId);
    try {
      const event = await fetchJsonBody<NBEvent>(
        `/api/events/${encodeURIComponent(eventId)}/cover?spaceId=${encodeURIComponent(spaceId)}`,
        'POST',
        { resourceId },
      );
      onPicked(event);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use that file');
    } finally {
      setApplying(null);
    }
  };

  return (
    <Modal onClose={onClose} title="Choose from the Drive" size="lg">
      <div className="relative mb-4">
        <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-grey" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pictures"
          className="w-full pl-9 pr-3 py-2 text-sm bg-transparent border border-border-subtle rounded-lg focus:outline-none focus:border-brand-black"
        />
      </div>

      {(error ?? driveError) && <Alert className="mb-3">{error ?? driveError}</Alert>}

      {images === null ? (
        <div className="py-12 flex justify-center">
          <LoaderCircleIcon className="w-5 h-5 animate-spin text-brand-grey" />
        </div>
      ) : shown.length === 0 ? (
        <p className="py-12 text-sm text-brand-grey text-center">
          {images.length === 0
            ? 'No pictures in this space’s Drive yet — upload one there and it will show up here.'
            : 'Nothing matches that.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {shown.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={() => pick(file.id)}
              disabled={applying !== null}
              className="group text-left disabled:opacity-50"
            >
              <div className="relative aspect-[16/9] rounded-lg overflow-hidden bg-surface-2 border border-border-subtle">
                {file.fileUrl && (
                  <img src={file.fileUrl} alt={file.name} className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 group-hover:bg-black/10 transition-colors" />
                {applying === file.id && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                    <LoaderCircleIcon className="w-5 h-5 animate-spin text-white" />
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs text-brand-black truncate">{file.name}</p>
              {file.folderId && (
                <p className="text-[11px] text-brand-grey inline-flex items-center gap-1">
                  <FolderIcon className="w-3 h-3" />
                  {folderName.get(file.folderId) ?? 'Folder'}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
