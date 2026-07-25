'use client';

// Shared types + small controls for the unified People & access console section
// (PeopleAccessPanel and its tabs). The permission math is the SAME pure core
// the server enforces (lib/notes/shared/authz.ts), so the "effective access"
// shown per member is exactly what the brain will let them do.

import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Users, UsersRound, User, FileText, Folder } from 'lucide-react';
import { useClickOutside } from '@/hooks/useClickOutside';
import type { TeamInfo } from '@/lib/notes/teams';
import type { AccessOverviewResponse } from '@/features/notes/lib/notesApi';
import {
  ACCESS_LEVELS,
  effectiveLevel,
  levelDisplayLabel,
  levelName,
  readableRoots,
  type AccessLevelName,
  type BrainAccess,
  type GrantSubjectType,
} from '@/lib/notes/shared/authz';
import { DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings';
import type { AccessRequest } from '@/lib/notes/shared/brainTypes';
import type { TreeNode } from '@/lib/notes/shared/types';
import { notesApi } from '@/features/notes/lib/notesApi';
import { Button } from '@/components/ui';

export interface CommunityMember {
  id: string;
  userId: string;
  role: string;
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
  title?: string;
}

/** Everything the tabs share, loaded once by PeopleAccessPanel. */
export interface PeopleData {
  members: CommunityMember[];
  teams: TeamInfo[];
  overview: AccessOverviewResponse | null;
  paths: PathOption[];
  /** Context access requests — own + everything an admin may resolve. */
  requests: AccessRequest[];
  /** The brain tree as the server returns it (root node), for hierarchy UIs. */
  tree: TreeNode | null;
  /** Admin-set display name for the brain root (default "Community context"). */
  contextName: string;
}

/** Display label for a numeric level (30 → 'Editor'). */
export function levelLabel(level: number): string {
  return levelDisplayLabel(levelName(level));
}

export function pathLabel(path: string, rootName = DEFAULT_CONTEXT_NAME): string {
  return path === '' ? rootName : path;
}

/** Flatten the notes tree into a picker-friendly list (folders first, sorted). */
export function flattenTree(root: TreeNode | null): PathOption[] {
  const folders: PathOption[] = [];
  const notes: PathOption[] = [];
  const walk = (node: TreeNode) => {
    for (const child of node.children ?? []) {
      if (child.kind === 'folder') {
        folders.push({ path: child.path, kind: 'folder' });
        walk(child);
      } else {
        notes.push({ path: child.path, kind: 'note', title: child.title });
      }
    }
  };
  if (root) walk(root);
  folders.sort((a, b) => a.path.localeCompare(b.path));
  notes.sort((a, b) => a.path.localeCompare(b.path));
  return [...folders, ...notes];
}

/**
 * The BrainAccess a specific member holds, assembled from the admin overview:
 * community-wide grants + grants of the teams they're in + their direct grants.
 * Mirrors lib/notes/access.ts:brainAccessFor.
 */
export function accessOfMember(
  userId: string,
  teams: TeamInfo[],
  overview: AccessOverviewResponse | null,
): BrainAccess {
  const teamIds = new Set(
    teams.filter((t) => t.members.some((m) => m.userId === userId)).map((t) => t.id),
  );
  const grants = (overview?.grants ?? [])
    .filter(
      (g) =>
        g.subjectType === 'community' ||
        (g.subjectType === 'team' && teamIds.has(g.subjectId)) ||
        (g.subjectType === 'user' && g.subjectId === userId),
    )
    .map((g) => ({
      subjectType: g.subjectType,
      subjectId: g.subjectId,
      resourcePath: g.resourcePath,
      level: g.level,
    }));
  return {
    grants,
    restricted: overview?.restricted ?? [],
    locked: overview?.locked ?? [],
  };
}

/** One-line summary of what a member can effectively reach in the brain. */
export function summarizeAccess(role: string, access: BrainAccess): string {
  if (role === 'admin') return 'Full · admin';
  const roots = readableRoots(access);
  if (roots.length === 0) return 'No access';
  const rootLevel = effectiveLevel(access, '');
  if (rootLevel > 0) return `${levelLabel(rootLevel)} · everywhere`;
  const top = Math.max(...roots.map((r) => effectiveLevel(access, r)));
  return `${levelLabel(top)} · ${roots.length} ${roots.length === 1 ? 'area' : 'areas'}`;
}

export function SubjectIcon({ type, className = 'h-4 w-4' }: { type: GrantSubjectType; className?: string }) {
  if (type === 'community') return <Users className={className} />;
  if (type === 'team') return <UsersRound className={className} />;
  return <User className={className} />;
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
      className="h-8 shrink-0 rounded-lg border border-border-default bg-surface-1 px-2 text-xs font-medium text-text-secondary disabled:opacity-40"
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

/**
 * Searchable path picker over the brain tree — 'Entire context' + every folder
 * and note. Type to filter; folders list before notes.
 */
export function PathPicker({
  paths,
  value,
  onChange,
  placeholder = 'Choose a folder or note…',
  rootName,
}: {
  paths: PathOption[];
  /** null = nothing chosen yet; '' = brain root. */
  value: string | null;
  onChange: (path: string) => void;
  placeholder?: string;
  /** Display name for the '' (brain root) entry. */
  rootName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: PathOption[] = [{ path: '', kind: 'folder' }, ...paths];
    if (!q) return all.slice(0, 40);
    return all
      .filter(
        (p) =>
          pathLabel(p.path, rootName).toLowerCase().includes(q) ||
          (p.title ?? '').toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [paths, query, rootName]);

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
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-border-default bg-surface-1 px-3 text-left text-sm text-text-secondary"
      >
        <span className="min-w-0 flex-1 truncate">
          {value === null ? <span className="text-text-muted">{placeholder}</span> : pathLabel(value, rootName)}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[260px] overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-xl">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter folders and notes…"
            className="w-full border-b border-border-subtle bg-transparent px-3 py-2 text-sm outline-none"
          />
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.map((p) => (
              <button
                key={p.path || '<root>'}
                type="button"
                onClick={() => pick(p.path)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2"
              >
                {p.path === '' ? (
                  <Users className="h-3.5 w-3.5 shrink-0 opacity-60" />
                ) : p.kind === 'folder' ? (
                  <Folder className="h-3.5 w-3.5 shrink-0 opacity-60" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0 opacity-60" />
                )}
                <span className="min-w-0 flex-1 truncate">{pathLabel(p.path, rootName)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-text-muted">No matches.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The per-subject grant editor shared by the member drawer and team cards:
 * the subject's grants as rows (path + in-place level change / remove) plus a
 * composer to grant a new path. subjectType/subjectId pick who receives them.
 */
export function GrantEditor({
  communityId,
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
  communityId: string;
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
      notesApi.accessAction(communityId, { action: 'grant', subjectType, subjectId, path, level: grantLevel }),
    );
  };

  return (
    <div className="space-y-1">
      {grants.map((grant) => (
        <div key={grant.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1">
          <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
            {pathLabel(grant.resourcePath, contextName)}
          </span>
          <LevelSelect
            value={levelName(grant.level) ?? 'view'}
            disabled={busy}
            allowRemove
            onRemove={() =>
              void run(() => notesApi.accessAction(communityId, { action: 'revoke', grantId: grant.id }))
            }
            onChange={(level) =>
              void run(() =>
                notesApi.accessAction(communityId, {
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
      {grants.length === 0 && <p className="px-1 text-xs text-text-muted">{emptyText}</p>}
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
          variant="pill-secondary"
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
