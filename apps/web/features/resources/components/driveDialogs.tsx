'use client';

/** The Drive's small dialogs: name a folder or file, and pick a folder to move into. */

import { useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';
import { ChevronRightIcon, FolderIcon } from '@/features/shared/icons';
import { childFolders, subtree } from '../lib/tree';
import type { ResourceFolder } from '@/lib/types';

export function NameDialog({
  title,
  label = 'Name',
  initial = '',
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  label?: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} disabled={!trimmed || trimmed === initial}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      <Field label={label}>
        <Input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={e => {
            // Select the stem, not the extension, so a rename keeps ".pdf" intact.
            const dot = initial.lastIndexOf('.');
            e.target.setSelectionRange(0, dot > 0 ? dot : initial.length);
          }}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
        />
      </Field>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </Modal>
  );
}

/**
 * Pick a destination folder. The tree is drawn in full, with the folder being
 * moved (and everything under it) greyed out — a folder cannot go inside itself.
 */
export function MoveDialog({
  folders,
  itemName,
  currentFolderId,
  movingFolderId,
  onMove,
  onClose,
}: {
  folders: ResourceFolder[];
  itemName: string;
  currentFolderId: string | null;
  /** Set when the thing being moved is itself a folder. */
  movingFolderId?: string;
  onMove: (folderId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<string | null>(currentFolderId);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(folders.map(f => f.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = movingFolderId ? subtree(folders, movingFolderId) : new Set<string>();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onMove(target);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not move');
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const renderLevel = (parentId: string | null, depth: number) =>
    childFolders(folders, parentId).map(f => {
      const kids = childFolders(folders, f.id);
      const disabled = blocked.has(f.id);
      const active = target === f.id;
      return (
        <div key={f.id}>
          <div
            className={`flex h-9 items-center gap-1 rounded-lg pr-2 text-sm transition-colors ${
              active ? 'bg-brand-green/10 text-text-primary' : disabled ? 'text-text-muted/50' : 'text-text-primary hover:bg-surface-2'
            }`}
            style={{ paddingLeft: 8 + depth * 18 }}
          >
            <button
              type="button"
              onClick={() => toggle(f.id)}
              className={`flex h-6 w-6 items-center justify-center rounded text-text-muted ${kids.length ? '' : 'invisible'}`}
              aria-label={expanded.has(f.id) ? 'Collapse' : 'Expand'}
            >
              <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${expanded.has(f.id) ? 'rotate-90' : ''}`} />
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setTarget(f.id)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-not-allowed"
            >
              <FolderIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{f.name}</span>
            </button>
          </div>
          {expanded.has(f.id) && renderLevel(f.id, depth + 1)}
        </div>
      );
    });

  return (
    <Modal
      onClose={onClose}
      title={`Move “${itemName}”`}
      size="sm"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text-muted">{error ?? ''}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="brand" size="sm" onClick={submit} loading={busy} disabled={target === currentFolderId}>
              Move
            </Button>
          </div>
        </div>
      }
    >
      <div className="max-h-[50vh] overflow-y-auto">
        <button
          type="button"
          onClick={() => setTarget(null)}
          className={`flex h-9 w-full items-center gap-2 rounded-lg px-2 text-sm transition-colors ${
            target === null ? 'bg-brand-green/10 text-text-primary' : 'text-text-primary hover:bg-surface-2'
          }`}
        >
          <FolderIcon className="h-4 w-4 shrink-0" />
          Resources
        </button>
        {renderLevel(null, 1)}
      </div>
    </Modal>
  );
}
