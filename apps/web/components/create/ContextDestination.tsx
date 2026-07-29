'use client';

// Destination picker shared by the Create modal's Context (note) and File
// (source) forms: where in the current community's context the new thing lands.
// Notes and sources share one brain-path namespace, so they share one picker —
// the folder list, the "New folder…" affordance, and the resulting path preview
// are identical for both.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { slugify } from '@/lib/eventUtils';
import { notesApi } from '@/features/notes/lib/notesApi';
import { contextKeys, swrFetch } from '@/features/notes/lib/contextPrefetch';
import type { TreeNode } from '@/lib/notes/shared/types';

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-border-default bg-surface-2 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-green/40 focus:border-brand-green transition-all';

export interface BrainTree {
  /** Every folder path in the brain, depth-first ('' root excluded). */
  folders: string[];
  /** Existing note paths — the modal de-duplicates the destination against these. */
  notePaths: Set<string>;
  loading: boolean;
  error: string | null;
}

function collect(node: TreeNode, folders: string[], notes: Set<string>): void {
  for (const child of node.children ?? []) {
    if (child.kind === 'folder') {
      folders.push(child.path);
      collect(child, folders, notes);
    } else {
      notes.add(child.path);
    }
  }
}

/**
 * The current brain's folder list + note paths, through the shared context
 * cache — the tree is usually already warm from the Context tab/sidebar, so the
 * picker paints filled in rather than empty-then-populated.
 */
export function useBrainTree(communityId: string | null, enabled: boolean): BrainTree {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!communityId || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    swrFetch(
      contextKeys.tree(communityId),
      () => notesApi.tree(communityId),
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
  }, [communityId, enabled]);

  return useMemo(() => {
    const folders: string[] = [];
    const notePaths = new Set<string>();
    if (tree) collect(tree, folders, notePaths);
    folders.sort((a, b) => a.localeCompare(b));
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
  folders: string[];
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
  const options = folders.includes(value) || !value ? folders : [...folders, value];

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
          <option key={folder} value={folder}>
            {' '.repeat((folder.split('/').length - 1) * 2)}
            {folder.split('/').pop()}
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

/** The `folder/name.ext` line under both forms — the exact destination path. */
export function PathPreview({ path, taken }: { path: string; taken?: boolean }) {
  return (
    <p className="truncate font-mono text-[11px] text-text-muted">
      {taken ? 'Saving as ' : ''}
      <span className="text-text-secondary">{path}</span>
    </p>
  );
}

/**
 * Where an entity's context note will land, for the forms whose namespace is
 * fixed (people/, events/, spaces/, channels/, communities/…). These get a
 * preview rather than a FolderPicker on purpose: the path→node resolution the
 * brain relies on is only sound while each kind owns its own namespace, so the
 * destination is shown, not chosen.
 *
 * Mirrors entityNotePath — the id it derives the filename from is
 * `<type>:<slugify(name)>`, so slug and path agree with what the server writes.
 * A name whose slug is taken gets a `-2` suffix server-side; that's rare enough
 * to leave out of the preview rather than round-trip for.
 */
export function EntityNotePreview({ dir, name }: { dir: string; name: string }) {
  const slug = useMemo(() => slugify(name), [name]);
  if (!slug) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-secondary">Context note</span>
      <PathPreview path={`${dir}/${slug}.md`} />
    </div>
  );
}
