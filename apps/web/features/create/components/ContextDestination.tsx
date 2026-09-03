'use client';

// Destination picker shared by the Create modal's Context (note) and File
// (source) forms: where in the current space's context the new thing lands.
// Notes and sources share one context-path namespace, so they share one picker —
// the folder list, the "New folder…" affordance, and the resulting path preview
// are identical for both.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderIcon, GripVerticalIcon } from '@/features/shared/icons';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, swrFetch } from '@/features/notes/lib/contextPrefetch';
import type { TreeNode } from '@/lib/notes/shared/types';

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-border-default bg-surface-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all';

/** A folder as the picker offers it: the path is the value, the label is the
 *  name the tree shows for it — its index note's title when it declares one. */
export interface FolderOption {
  path: string;
  label: string;
}

export interface ContextFolderTree {
  /** Every folder in the context, depth-first ('' root excluded). */
  folders: FolderOption[];
  /** Existing note paths — the modal de-duplicates the destination against these. */
  notePaths: Set<string>;
  loading: boolean;
  error: string | null;
}

function collect(node: TreeNode, folders: FolderOption[], notes: Set<string>): void {
  for (const child of node.children ?? []) {
    if (child.kind === 'folder') {
      folders.push({ path: child.path, label: child.title ?? child.name });
      collect(child, folders, notes);
    } else {
      notes.add(child.path);
    }
  }
}

/**
 * The current context's folder list + note paths, through the shared context
 * cache — the tree is usually already warm from the Context tab/sidebar, so the
 * picker paints filled in rather than empty-then-populated.
 */
export function useContextFolderTree(spaceId: string | null, enabled: boolean): ContextFolderTree {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!spaceId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    swrFetch(
      contextKeys.tree(spaceId),
      () => notesApi.tree(spaceId),
      ({ tree: t }) => {
        if (!cancelled) setTree(t);
      },
    )
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load context');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, enabled]);

  return useMemo(() => {
    const folders: FolderOption[] = [];
    const notePaths = new Set<string>();
    if (tree) collect(tree, folders, notePaths);
    // By path, so a child always follows its parent and the indentation reads.
    folders.sort((a, b) => a.path.localeCompare(b.path));
    return { folders, notePaths, loading, error };
  }, [tree, loading, error]);
}

/**
 * Folder select + inline "New folder" entry. The folder is only a string here —
 * a brand-new one is created server-side at submit time (the notes API creates
 * intermediate folders implicitly on write, so this stays a plain value).
 */
export function FolderPicker({
  folders,
  value,
  onChange,
  contextName,
}: {
  folders: FolderOption[];
  value: string;
  onChange: (folder: string) => void;
  contextName: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const commitDraft = useCallback(() => {
    const clean = draft.trim().replace(/^\/+|\/+$/g, '');
    if (clean) onChange(clean);
    setCreating(false);
    setDraft('');
  }, [draft, onChange]);

  // A folder chosen earlier that no longer matches the loaded list (freshly
  // typed) still needs an option, or the select would snap back to the root.
  const options =
    !value || folders.some((f) => f.path === value)
      ? folders
      : [...folders, { path: value, label: value.split('/').pop() ?? value }];

  if (creating) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          className={inputClass}
          placeholder="e.g. playbooks or deals/2026"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Escape') {
              setCreating(false);
              setDraft('');
            }
          }}
        />
        <button
          type="button"
          onClick={commitDraft}
          className="shrink-0 rounded-lg border border-border-default px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-green/60 hover:text-text-primary"
        >
          Use
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{contextName} (top level)</option>
        {options.map((folder) => (
          <option key={folder.path} value={folder.path}>
            {' '.repeat((folder.path.split('/').length - 1) * 2)}
            {folder.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setCreating(true);
        }}
        className="shrink-0 rounded-lg border border-border-default px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-green/60 hover:text-text-primary"
      >
        New folder
      </button>
    </div>
  );
}

/**
 * The destination board: every folder in the context as a drop target, and the
 * draft as a card you drag into one. Dropping IS the create — that's the whole
 * gesture, and it's why this isn't a select. Clicking a row does the same
 * thing, so the board works from the keyboard and on touch, where HTML5 drag
 * doesn't fire at all.
 *
 * `folders` is already depth-first by path, so indenting by depth reproduces
 * the tree without rebuilding it.
 */
export function FolderDropBoard({
  folders,
  contextName,
  cardLabel,
  accent,
  busy = false,
  loading = false,
  pathFor,
  onPick,
}: {
  folders: FolderOption[];
  contextName: string;
  /** What's being filed — shown on the draggable card. */
  cardLabel: string;
  /** The draft's type colour, for the card and the hovered row. */
  accent: string;
  busy?: boolean;
  loading?: boolean;
  /** Full note path if it landed in this folder — previewed under the hover. */
  pathFor: (folder: string) => string;
  onPick: (folder: string) => void;
}) {
  // The row the pointer is over mid-drag. Tracked as a value rather than a CSS
  // :hover because dragover fires on descendants too, and a class would flicker
  // as the pointer crosses the label inside the row.
  const [over, setOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');

  const rows: FolderOption[] = [{ path: '', label: `${contextName} (top level)` }, ...folders];

  const pick = (folder: string) => {
    if (busy) return;
    setOver(null);
    setDragging(false);
    onPick(folder);
  };

  return (
    <div className="space-y-3">
      <div
        draggable={!busy}
        onDragStart={(e) => {
          setDragging(true);
          // Firefox ignores a drag with no payload; the value is unused (the
          // board knows what it's filing) but it has to be set.
          e.dataTransfer.setData('text/plain', cardLabel);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { setDragging(false); setOver(null); }}
        className={`flex cursor-grab items-center gap-2 rounded-xl border-2 border-dashed px-3 py-2.5 text-sm font-medium transition active:cursor-grabbing ${
          dragging ? 'opacity-50' : ''
        }`}
        style={{ borderColor: accent, color: accent }}
      >
        <GripVerticalIcon className="h-4 w-4 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{cardLabel}</span>
        <span className="shrink-0 text-[11px] font-normal opacity-70">drag into a folder</span>
      </div>

      <div className="max-h-64 overflow-y-auto rounded-xl border border-border-subtle">
        {loading && folders.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-text-muted">Loading folders…</p>
        )}
        {rows.map((row) => {
          const depth = row.path ? row.path.split('/').length - 1 : 0;
          const isOver = over === row.path;
          return (
            <button
              key={row.path || '__root__'}
              type="button"
              disabled={busy}
              onClick={() => pick(row.path)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(row.path); }}
              onDragLeave={() => setOver((p) => (p === row.path ? null : p))}
              onDrop={(e) => { e.preventDefault(); pick(row.path); }}
              className="flex w-full items-center gap-2 border-b border-border-subtle px-3 py-2 text-left text-sm transition last:border-b-0 hover:bg-surface-2 disabled:cursor-not-allowed"
              style={{
                paddingLeft: 12 + depth * 14,
                background: isOver ? `${accent}1a` : undefined,
                boxShadow: isOver ? `inset 2px 0 0 ${accent}` : undefined,
              }}
            >
              <FolderIcon className="h-4 w-4 shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-text-primary">{row.label}</span>
              {isOver && (
                <span className="shrink-0 truncate font-mono text-[11px] text-text-muted">
                  {pathFor(row.path)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {creating ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            className={inputClass}
            placeholder="e.g. playbooks or deals/2026"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const clean = draft.trim().replace(/^\/+|\/+$/g, '');
                if (clean) pick(clean);
              } else if (e.key === 'Escape') {
                setCreating(false);
                setDraft('');
              }
            }}
          />
          <button
            type="button"
            onClick={() => {
              const clean = draft.trim().replace(/^\/+|\/+$/g, '');
              if (clean) pick(clean);
            }}
            className="shrink-0 rounded-lg border border-border-default px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-brand-green/60 hover:text-text-primary"
          >
            Use
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs font-semibold text-text-muted transition hover:text-text-primary"
        >
          + New folder
        </button>
      )}
    </div>
  );
}

/** The `folder/name.ext` line under both forms — the exact destination path. */
export function PathPreview({ path, taken }: { path: string; taken?: boolean }) {
  return (
    <p className="truncate font-mono text-[11px] text-text-muted">
      {taken ? 'Saving as ' : ''}
      <span className="text-text-secondary">{path}</span>
    </p>
  );
}
