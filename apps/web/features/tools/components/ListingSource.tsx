'use client';

import { useEffect, useState } from 'react';
import { Modal, Select, Skeleton } from '@visvine/ui';
import { fetchListingSource } from '../lib/client';

/**
 * A listed Tool's source, read-only — what an admin would run, read before
 * they run it. One file at a time, as written.
 */
export default function ListingSource({ listingId, title, onClose }: { listingId: string; title: string; onClose: () => void }) {
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [file, setFile] = useState<string>('src/ui.tsx');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchListingSource(listingId, ctl.signal)
      .then((res) => {
        setFiles(res.files);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load the source');
      });
    return () => ctl.abort();
  }, [listingId]);

  const names = files ? Object.keys(files).sort((a, b) => (a === 'src/ui.tsx' ? -1 : b === 'src/ui.tsx' ? 1 : a.localeCompare(b))) : [];

  return (
    <Modal onClose={onClose} title={title} size="lg">
      <div className="flex flex-col gap-3 px-6 py-4">
        {error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !files ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <>
            <Select className="w-56" value={file} onChange={(e) => setFile(e.target.value)} aria-label="File">
              {names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <pre className="max-h-[60vh] overflow-auto rounded-lg border border-line-subtle bg-surface-subtle p-4 font-mono text-xs text-fg">
              {files[file] ?? ''}
            </pre>
          </>
        )}
      </div>
    </Modal>
  );
}
