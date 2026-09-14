'use client';

import { useCallback, useRef, useState } from 'react';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, invalidateContextCache } from '@/features/notes/lib/contextPrefetch';
import { sourceHref } from '@/lib/notes/entities';
import { MAX_SOURCE_BYTES, SOURCE_ACCEPT, SOURCE_EXTENSIONS_LABEL, sourceKindOf } from '@/lib/notes/shared/sourceTypes';
import { formatBytes } from '@/lib/utils';
import { FolderPicker, useContextFolderTree } from '../ContextDestination';
import { SetupSection, useDraftCommit, type DraftKindProps } from './shared';

type FileUploadStatus = 'queued' | 'uploading' | 'done' | 'failed';

interface FileEntry {
  file: File;
  status: FileUploadStatus;
  /** Context path the source landed at, once uploaded. */
  path?: string;
  error?: string;
}

/** Reject unsupported/oversized files at pick time, before any round-trip. */
function rejectionReason(file: File): string | null {
  if (!sourceKindOf(file.name)) return 'Unsupported type';
  if (file.size > MAX_SOURCE_BYTES) return `Over ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB`;
  return null;
}

const STATUS_STYLE: Record<FileUploadStatus, { label: string; className: string }> = {
  queued: { label: 'Ready', className: 'text-text-muted' },
  uploading: { label: 'Uploading…', className: 'text-text-secondary' },
  done: { label: 'Added', className: 'text-brand-green' },
  failed: { label: 'Failed', className: 'text-red-500' },
};

/**
 * Files into the context: the drop zone, the queue and the folder they land
 * in. A file is bytes rather than prose — there is nothing to write in front
 * of it — so the draft hides its title and its editor and shows only this.
 *
 * Uploaded one at a time, because each request runs the whole extract → chunk
 * → embed pipeline, so a parallel burst would just contend. A file that fails
 * leaves the others alone.
 */
export default function FileSetup({ shared, onReadyChange, registerCommit }: DraftKindProps) {
  const { spaceId, contextName } = shared;
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [folder, setFolder] = useState(shared.folder);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tree = useContextFolderTree(spaceId, true);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    setFiles((existing) => {
      const seen = new Set(existing.map((f) => `${f.file.name}:${f.file.size}`));
      const next: FileEntry[] = [];
      for (const file of Array.from(incoming)) {
        if (seen.has(`${file.name}:${file.size}`)) continue;
        const reason = rejectionReason(file);
        next.push(reason ? { file, status: 'failed', error: reason } : { file, status: 'queued' });
      }
      return next.length ? [...existing, ...next] : existing;
    });
  };

  const commit = useCallback(async () => {
    const queue = files.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.status === 'queued');
    const patch = (index: number, next: Partial<FileEntry>) =>
      setFiles((all) => all.map((f, i) => (i === index ? { ...f, ...next } : f)));

    let uploaded = 0;
    let lastPath: string | null = null;
    for (const { entry, index } of queue) {
      patch(index, { status: 'uploading', error: undefined });
      try {
        const { source } = await notesApi.uploadSource(spaceId, entry.file, folder);
        patch(index, { status: 'done', path: source.path });
        uploaded++;
        lastPath = source.path;
      } catch (err) {
        patch(index, { status: 'failed', error: err instanceof Error ? err.message : 'Upload failed' });
      }
    }
    if (!uploaded) throw new Error('Nothing uploaded');
    invalidateContextCache(contextKeys.tree(spaceId), contextKeys.list(spaceId));
    return uploaded === 1 && lastPath ? sourceHref(lastPath) : '/directory/note/index.md';
  }, [spaceId, files, folder]);

  useDraftCommit({ onReadyChange, registerCommit }, files.some((f) => f.status === 'queued'), commit);

  return (
    <SetupSection label="What to upload">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-10 text-center transition-colors ${
          dragging ? 'border-brand-green bg-brand-green/10' : 'border-border-subtle hover:border-border-default'
        }`}
      >
        <span className="text-sm text-text-primary">
          Drop files or <span className="text-brand-green">browse</span>
        </span>
        <span className="text-[11px] text-text-muted">
          {SOURCE_EXTENSIONS_LABEL} · {Math.round(MAX_SOURCE_BYTES / (1024 * 1024))} MB
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={SOURCE_ACCEPT}
          className="sr-only"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {files.length > 0 && (
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {files.map((entry, i) => {
            const status = STATUS_STYLE[entry.status];
            return (
              <li key={`${entry.file.name}-${i}`} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{entry.file.name}</p>
                  <p className="truncate text-[11px] text-text-muted" title={entry.error ?? undefined}>
                    {formatBytes(entry.file.size)}
                    <span className={`ml-2 ${status.className}`}>{entry.error ?? status.label}</span>
                  </p>
                </div>
                {entry.status !== 'uploading' && (
                  <button
                    type="button"
                    onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                    aria-label={`Remove ${entry.file.name}`}
                    className="shrink-0 text-text-muted transition-colors hover:text-red-500"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <FolderPicker folders={tree.folders} value={folder} onChange={setFolder} contextName={contextName} />
    </SetupSection>
  );
}
