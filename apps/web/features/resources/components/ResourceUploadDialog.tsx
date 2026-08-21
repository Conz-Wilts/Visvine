'use client';
import { useState, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import { UploadIcon } from '@/features/shared/icons';
import { driveApi } from '../lib/driveApi';

/**
 * Pick files to put in the current folder. Each is one call: the server stores
 * the bytes, records the file and runs it through the RAG pipeline.
 */
export default function ResourceUploadDialog({
  spaceId,
  folderId,
  folderName,
  onClose,
  onUploaded,
}: {
  spaceId: string;
  folderId: string | null;
  folderName: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(list: FileList | File[]) {
    const files = Array.from(list);
    if (!files.length) return;
    setError(null);
    setProgress({ done: 0, total: files.length });
    const failures: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        await driveApi.upload(spaceId, file, folderId);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'upload failed';
        // Storage errors can be a whole JSON blob; the first line is the part that helps.
        failures.push(`${file.name}: ${reason.split('\n')[0].slice(0, 160)}`);
      }
      setProgress({ done: i + 1, total: files.length });
    }
    onUploaded();
    if (failures.length) {
      setError(failures.join('\n'));
      setProgress(null);
    } else {
      onClose();
    }
  }

  const busy = progress !== null;

  return (
    <Modal
      onClose={onClose}
      title={`Upload to ${folderName}`}
      size="sm"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
    >
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) void handleFiles(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? 'border-brand-green bg-brand-green/5' : 'border-border-default hover:border-text-muted'
        }`}
      >
        <UploadIcon className="h-6 w-6 text-text-muted" />
        {busy ? (
          <p className="text-sm text-text-muted">Uploading {progress.done + 1 > progress.total ? progress.total : progress.done + 1} of {progress.total}…</p>
        ) : (
          <>
            <p className="text-sm text-text-primary">Drop files here, or click to browse</p>
            <p className="text-xs text-text-muted">PDF, Excel, CSV, DOCX, Markdown, JSON, text or images · up to 25MB each</p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }}
      />
      {error && <p className="mt-3 whitespace-pre-wrap break-words text-xs text-red-600">{error}</p>}
    </Modal>
  );
}
