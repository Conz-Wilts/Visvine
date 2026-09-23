'use client';

// Shared types + small controls for the membership surfaces (the Members
// section and the alias panel), which read one snapshot from PeopleDataContext.
// The levels offered here are the SAME pure core the server enforces
// (lib/notes/shared/authz.ts), so a grant made here means exactly what the
// context will honour.

import { useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, FileTextIcon, FolderIcon, UsersIcon } from '@/features/shared/icons';
import { useClickOutside } from '@/features/shared/hooks/useClickOutside';
import type { AliasInfo } from '@/lib/notes/aliases';
import type { AccessOverviewResponse } from '@/features/notes/lib/notesApi';
import {
  ACCESS_LEVELS,
  levelName,
  type AccessLevelName,
  type GrantSubjectType,
} from '@/lib/notes/shared/authz';
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings';
import { humanizeFolderName, isIndexPath } from '@/lib/notes/shared/indexNote';
import type { AccessRequest } from '@/lib/notes/shared/contextTypes';
import type { TreeNode } from '@/lib/notes/shared/types';
import { notesApi } from '@/features/notes/lib/notesApi';
import { Button, chipClass, chipStyle } from '@/components/ui';

export interface SpaceMember {
  id: string;
  userId: string;
  /** The Person aliases this person holds — their entire standing here. */
  aliases: string[];
  status: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt?: string;
  };
}

export type OverviewGrant = NonNullable<AccessOverviewResponse['grants']>[number];

export interface PathOption {
  path: string;
  kind: 'folder' | 'note';
  /** The folder's index title, or the note's title — what a reader calls it. */
  title?: string;
}

/** Everything the sections share, loaded once by PeopleDataProvider. */
export interface PeopleData {
  members: SpaceMember[];
  aliases: AliasInfo[];
  overview: AccessOverviewResponse | null;
  paths: PathOption[];
  /** Context access requests — own + everything an admin may resolve. */
  requests: AccessRequest[];
  /** The context tree as the server returns it (root node), for hierarchy UIs. */
  tree: TreeNode | null;
  /** Admin-set display name for the context root (default "Space context"). */
  contextName: string;
}

/**
 * A single alias, on or off. The only control a person's standing needs, in the
 * drawer under a member's row.
 *
 * The built-in Admin alias wears gold whichever way it is flipped, so the one
 * thing that grants the space is never mistaken for an ordinary label.
 */
export function AliasToggle({ name, color, admin, on, onClick, disabled }: {
  name: string;
  /** The alias's own colour — gold for the built-in Admin, which can't be
   *  recoloured, so it stays gold whichever way this is flipped. */
  color: string;
  admin: boolean;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      title={admin ? `${name} — is admin of the space` : name}
      // An alias is painted in its own colour whichever way it is flipped —
      // the colour IS the alias, and draining it out of the unheld state made
      // the row read as six different controls. Held is the same chip with a
      // ring around it, the way the Create modal's alias picker marks its
      // choice.
      className={chipClass({
        tone: 'solid',
        size: 'md',
        color,
        interactive: true,
      })}
      style={{ ...chipStyle(color, 'solid'), boxShadow: on ? `0 0 0 3px ${color}55` : 'none' }}
    >
      {name}
    </button>
  );
}

/**
 * What a grantable resource is called, and where it sits.
 *
 * Access is given to things people can name — "Everything in Blackbird", the
 * Handbook, the Research folder — so this resolves a stored path back to the
 * title the tree carries for it, with the containing folder as a muted hint. A
 * path the tree doesn't hold (a grant on something since renamed, or a note the
 * viewer can't see) still reads as itself rather than blank.
 */
function describePath(
  path: string,
  contextName: string,
  paths: PathOption[] = [],
): { label: string; hint: string } {
  if (path === '') return { label: `Everything in ${contextName || DEFAULT_CONTEXT_NAME}`, hint: '' };
  const known = paths.find((p) => p.path === path);
  const segments = path.split('/');
  const parent = segments.slice(0, -1).join('/');
  const own = segments[segments.length - 1].replace(/\.md$/i, '');
  return {
    label: known?.title ?? (known?.kind === 'folder' ? humanizeFolderName(own) : own),
    hint: parent,
  };
}

/**
 * Flatten the notes tree into a picker-friendly list (folders first, sorted).
 *
 * Index notes are left out on purpose: an index note and its folder are the same
 * thing (lib/notes/shared/indexNote.ts), so listing both would offer "Research"
 * and "Research/index.md" as two different places to grant — and at the root,
 * "index.md" beside the context itself, which reads as two competing roots.
 * The folder row (and the root row the picker adds) already stands for it.
 */
export function flattenTree(root: TreeNode | null): PathOption[] {
  const folders: PathOption[] = [];
  const notes: PathOption[] = [];
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.kind === 'folder') {
        folders.push({ path: child.path, kind: 'folder', title: child.title });
        walk(child);
      } else if (!isIndexPath(child.path)) {
        notes.push({ path: child.path, kind: 'note', title: child.title });
      }
    }
  };
  if (root) walk(root);
  folders.sort((a, b) => a.path.localeCompare(b.path));
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return [...folders, ...notes];
}

/** Compact level select for dense grant rows (upserts on change). */
export function LevelSelect({
  value,
  onChange,
  disabled,
  allowRemove,
  onRemove,
}: {
  value: AccessLevelName;
  onChange: (level: AccessLevelName) => void;
  disabled?: boolean;
  /** Adds a "Remove access" item at the bottom of the menu. */
  allowRemove?: boolean;
  onRemove?: () => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (e.target.value === '__remove') onRemove?.();
        else onChange(e.target.value as AccessLevelName);
      }}
      className="h-8 shrink-0 rounded-lg border border-line bg-surface px-2 text-xs font-medium text-fg-secondary disabled:opacity-40"
    >
      {ACCESS_LEVELS.map((l) => (
        <option key={l.name} value={l.name}>
          {l.label}
        </option>
      ))}
      {allowRemove && <option value="__remove">Remove access</option>}
    </select>
  );
}

/** A resource by the name it goes by, with its folder trailing in muted text. */
export function PathLabel({ path, contextName, paths }: {
  path: string;
  contextName: string;
  paths: PathOption[];
}) {
  const { label, hint } = describePath(path, contextName, paths);
  return (
    <span className="min-w-0 flex-1 truncate">
      {label}
      {hint && <span className="ml-1.5 text-xs text-fg-muted">{hint}</span>}
    </span>
  );
}

/**
 * Searchable path picker over the context tree — the whole context + every folder
 * and note. Type to filter; folders list before notes.
 */
function PathPicker({
  paths,
  value,
  onChange,
  placeholder = 'Choose a folder or note…',
  rootName,
}: {
  paths: PathOption[];
  /** null = nothing chosen yet; '' = context root. */
  value: string | null;
  onChange: (path: string) => void;
  placeholder?: string;
  /** Display name for the '' (context root) entry. */
  rootName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const contextName = rootName ?? DEFAULT_CONTEXT_NAME;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: PathOption[] = [{ path: '', kind: 'folder' }, ...paths];
    if (!q) return all.slice(0, 40);
    // Match what's on screen AND the raw path: somebody who knows the file can
    // still type it, and everyone else searches the words they can see.
    return all
      .filter((p) => {
        const { label, hint } = describePath(p.path, contextName, paths);
        return (
          label.toLowerCase().includes(q) ||
          hint.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q)
        );
      })
      .slice(0, 40);
  }, [paths, query, contextName]);

  const pick = (path: string) => {
    onChange(path);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3 text-left text-sm text-fg-secondary"
      >
        {value === null ? (
          <span className="min-w-0 flex-1 truncate text-fg-muted">{placeholder}</span>
        ) : (
          <PathLabel path={value} contextName={contextName} paths={paths} />
        )}
        <ChevronDownIcon className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[260px] overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-float">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter folders and notes…"
            className="w-full border-b border-line-subtle bg-transparent px-3 py-2 text-sm outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((p) => (
              <button
                key={p.path || '<root>'}
                type="button"
                onClick={() => pick(p.path)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-subtle"
              >
                {p.path === '' ? (
                  <UsersIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                ) : p.kind === 'folder' ? (
                  <FolderIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                ) : (
                  <FileTextIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                )}
                <PathLabel path={p.path} contextName={contextName} paths={paths} />
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-fg-muted">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The per-subject grant editor shared by the member drawer and alias cards:
 * the subject's grants as rows (path + in-place level change / remove) plus a
 * composer to grant a new path. subjectType/subjectId pick who receives them.
 */
export function GrantEditor({
  spaceId,
  subjectType,
  subjectId,
  grants,
  paths,
  contextName,
  busy,
  run,
  emptyText,
  placeholder,
  addLabel,
}: {
  spaceId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
  grants: OverviewGrant[];
  paths: PathOption[];
  contextName: string;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  emptyText: string;
  placeholder: string;
  addLabel: string;
}) {
  const [grantPath, setGrantPath] = useState<string | null>(null);
  const [grantLevel, setGrantLevel] = useState<AccessLevelName>('view');

  const addGrant = () => {
    if (grantPath === null) return;
    const path = grantPath;
    setGrantPath(null);
    void run(() =>
      notesApi.accessAction(spaceId, { action: 'grant', subjectType, subjectId, path, level: grantLevel }),
    );
  };

  return (
    <div className="space-y-1">
      {grants.map((grant) => (
        <div key={grant.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-fg">
          <PathLabel path={grant.resourcePath} contextName={contextName} paths={paths} />
          <LevelSelect
            value={levelName(grant.level) ?? 'view'}
            disabled={busy}
            allowRemove
            onRemove={() =>
              void run(() => notesApi.accessAction(spaceId, { action: 'revoke', grantId: grant.id }))
            }
            onChange={(level) =>
              void run(() =>
                notesApi.accessAction(spaceId, {
                  action: 'grant',
                  subjectType,
                  subjectId,
                  path: grant.resourcePath,
                  level,
                }),
              )
            }
          />
        </div>
      ))}
      {grants.length === 0 && <p className="px-1 text-xs text-fg-muted">{emptyText}</p>}
      <div className="flex items-center gap-2 pt-1">
        <PathPicker
          paths={paths}
          value={grantPath}
          onChange={setGrantPath}
          placeholder={placeholder}
          rootName={contextName}
        />
        <LevelSelect value={grantLevel} onChange={setGrantLevel} disabled={busy} />
        <Button
          variant="brand"
          onClick={addGrant}
          disabled={busy || grantPath === null}
          className="!px-3 !py-1.5 !text-xs"
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
