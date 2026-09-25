'use client';

import { useEffect, useState } from 'react';
import { Button, FileTypeIcon, Modal } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import { ChevronRightIcon } from '@/features/shared/icons';
import { RESOURCES_ROOT, crumbsOf, type ResourceFolderView } from '@/lib/resources/shared/resourceTree';

/**
 * Pick a folder of `resources/` to file resources in: walk the tree a folder
 * at a time (the same list read the browser makes) and press Move here.
 */
export default function MoveDialog({
  spaceId,
  count,
  from,
  onClose,
  onMove,
}: {
  spaceId: string;
  count: number;
  /** Where the browser stands; the walk starts there. */
  from: string;
  onClose: () => void;
  onMove: (folder: string) => Promise<void>;
}) {
  const [at, setAt] = useState(from);
  const [folders, setFolders] = useState<ResourceFolderView[] | null>(null);
  const [moving, setMoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFolders(null);
    fetchJson<{ folders?: ResourceFolderView[] }>(
      `/api/spaces/${encodeURIComponent(spaceId)}/resources?folder=${encodeURIComponent(at)}&limit=1`,
    )
      .then((page) => !cancelled && setFolders(page.folders ?? []))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, [spaceId, at]);

  const move = async () => {
    setMoving(true);
    setProblem(null);
    try {
      await onMove(at);
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not move it');
    } finally {
      setMoving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={count === 1 ? 'Move to' : `Move ${count} to`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-6 py-4">
          {problem && <p className="mr-auto text-sm text-danger">{problem}</p>}
          <Button variant="neutral" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="brand" onClick={move} loading={moving}>
            Move here
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-6 py-4">
        <FolderCrumbs folder={at} onPick={setAt} />
        <div className="max-h-64 overflow-y-auto">
          {folders?.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => setAt(f.path)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg-secondary hover:bg-surface-subtle"
            >
              <FileTypeIcon kind="folder" size="xs" />
              <span className="min-w-0 flex-1 truncate">{f.title}</span>
              <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/** `Resources / Design / Logos`, each step pressable; the last is where you stand. */
export function FolderCrumbs({
  folder,
  onPick,
  onDropOn,
}: {
  folder: string;
  onPick: (folder: string) => void;
  /** Dropping a dragged resource on a step files it there. */
  onDropOn?: (folder: string, e: React.DragEvent) => void;
}) {
  const crumbs = crumbsOf(folder);
  return (
    <nav aria-label="Folder" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
      {crumbs.map((path, i) => {
        const last = i === crumbs.length - 1;
        const label = path === RESOURCES_ROOT ? 'Resources' : path.slice(path.lastIndexOf('/') + 1);
        return (
          <span key={path} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span className="text-fg-muted">/</span>}
            <button
              type="button"
              disabled={last}
              onClick={() => onPick(path)}
              onDragOver={onDropOn && !last ? (e) => e.preventDefault() : undefined}
              onDrop={onDropOn && !last ? (e) => onDropOn(path, e) : undefined}
              className={last ? 'truncate font-semibold text-fg' : 'truncate rounded px-1 text-fg-muted hover:bg-surface-subtle hover:text-fg'}
            >
              {label}
            </button>
          </span>
        );
      })}
    </nav>
  );
}
