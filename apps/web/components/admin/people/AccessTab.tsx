'use client';

// People & access → Context access, modeled on the two simplest mainstream
// permission surfaces: Google Drive's share dialog (one "General access"
// control + a people list) and Notion's teamspace list (one row per space
// showing who's inside, click to manage). This page is just those two ideas:
//
//   1. General access — a single level select for "Everyone in the community".
//   2. The context tree — folders expand to show subfolders AND notes, every
//      row summarizes who can see it and opens the SAME Share dialog used
//      across the notes UI (folder or single note), so there is exactly one
//      place people learn to manage access.
//
// The full grant audit (every row, inline editing) and folder locking stay
// available under a collapsed Advanced section for admins who need them.

import { useMemo, useState } from 'react';
import { ChevronRight, FileText, Folder, Lock, Pencil, Users } from 'lucide-react';
import { Avatar, Button, Input, SettingsSection } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { notesApi } from '@/features/notes/lib/notesApi';
import { SharePanel } from '@/features/notes/components/SharePanel';
import {
  ACCESS_LEVELS,
  canRead,
  effectiveLevel,
  levelName,
  type AccessLevelName,
} from '@/lib/notes/shared/authz';
import { CONTEXT_NAME_MAX_LENGTH, DEFAULT_CONTEXT_NAME } from '@/lib/notes/shared/contextSettings';
import type { TreeNode } from '@/lib/notes/shared/types';
import {
  accessOfMember,
  levelLabel,
  pathLabel,
  LevelSelect,
  SubjectIcon,
  type OverviewGrant,
  type PeopleData,
} from './shared';

interface Props {
  communityId: string;
  data: PeopleData;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  reload: () => Promise<void>;
}

/** Compact select for General access — the level select plus a "No access" state. */
function GeneralAccessSelect({ value, disabled, onChange }: {
  value: AccessLevelName | 'none';
  disabled?: boolean;
  onChange: (level: AccessLevelName | 'none') => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as AccessLevelName | 'none')}
      className="h-9 shrink-0 rounded-lg border border-border-default bg-surface-1 px-2 text-sm font-medium text-text-secondary disabled:opacity-40"
    >
      <option value="none">No access</option>
      {ACCESS_LEVELS.map((l) => (
        <option key={l.name} value={l.name}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export default function AccessTab({ communityId, data, busy, run, reload }: Props) {
  const [shareTarget, setShareTarget] = useState<{ path: string; kind: 'note' | 'folder' } | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const saveContextName = () => {
    setRenaming(false);
    void run(() => notesApi.setContextName(communityId, nameDraft));
  };

  const grants = useMemo(() => data.overview?.grants ?? [], [data.overview]);
  const restricted = useMemo(() => new Set(data.overview?.restricted ?? []), [data.overview]);
  const locked = useMemo(() => new Set(data.overview?.locked ?? []), [data.overview]);
  const activeMembers = useMemo(
    () => data.members.filter((m) => m.status === 'active'),
    [data.members],
  );

  // The community-wide grant on the brain root — the "General access" control.
  const rootCommunityGrant = grants.find(
    (g) => g.subjectType === 'community' && g.resourcePath === '',
  );
  const generalLevel: AccessLevelName | 'none' = rootCommunityGrant
    ? (levelName(rootCommunityGrant.level) ?? 'none')
    : 'none';

  const setGeneralAccess = (level: AccessLevelName | 'none') => {
    void run(() =>
      level === 'none'
        ? rootCommunityGrant
          ? notesApi.accessAction(communityId, { action: 'revoke', grantId: rootCommunityGrant.id })
          : Promise.resolve()
        : notesApi.accessAction(communityId, {
            action: 'grant',
            subjectType: 'community',
            path: '',
            level,
          }),
    );
  };

  // Each member's assembled access, computed once and reused per folder row.
  const memberAccess = useMemo(
    () =>
      activeMembers.map((m) => ({
        member: m,
        access: accessOfMember(m.userId, data.teams, data.overview),
      })),
    [activeMembers, data.teams, data.overview],
  );

  const toggleFolder = (path: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Who can read each path + its one-phrase row summary, precomputed for every
  // path once per data load — tree rows just look theirs up, so expanding a
  // folder doesn't re-walk every member's grants for every other row.
  const summaries = useMemo(() => {
    const restrictedList = [...restricted];
    const communityGrants = grants.filter((g) => g.subjectType === 'community');
    const map = new Map<string, { readers: PeopleData['members']; label: string }>();
    for (const path of ['', ...data.paths.map((p) => p.path)]) {
      const readers = memberAccess.filter(
        ({ member, access }) => member.role === 'admin' || canRead(access, path),
      );
      const everyoneReads =
        readers.length === activeMembers.length &&
        communityGrants.some(
          (g) => effectiveLevel({ grants: [g], restricted: restrictedList, locked: [] }, path) > 0,
        );
      const label = restricted.has(path)
        ? `Restricted · ${readers.length} ${readers.length === 1 ? 'person' : 'people'}`
        : everyoneReads
          ? 'Everyone in the community'
          : `${readers.length} ${readers.length === 1 ? 'person' : 'people'}`;
      map.set(path, { readers: readers.map((r) => r.member), label });
    }
    return map;
  }, [data.paths, memberAccess, grants, restricted, activeMembers.length]);

  const summarize = (path: string) => summaries.get(path) ?? { readers: [], label: '' };

  const grantsByPath = useMemo(() => {
    const map = new Map<string, OverviewGrant[]>();
    for (const grant of grants) {
      const list = map.get(grant.resourcePath) ?? [];
      list.push(grant);
      map.set(grant.resourcePath, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [grants]);

  const allFolders = useMemo(() => data.paths.filter((p) => p.kind === 'folder'), [data.paths]);

  return (
    <div className="space-y-8">
      <SettingsSection title="General access">
        <div className="flex items-center gap-3 rounded-2xl border border-border-default bg-surface-1 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-secondary">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text-primary">Everyone in the community</div>
            <div className="text-xs text-text-muted">
              {generalLevel === 'none'
                ? 'Members only see folders they, or their teams, were given'
                : `Every member is at least ${levelLabel(rootCommunityGrant?.level ?? 0)} everywhere`}
            </div>
          </div>
          <GeneralAccessSelect value={generalLevel} disabled={busy} onChange={setGeneralAccess} />
        </div>
      </SettingsSection>

      <SettingsSection title="Folders and notes" description="Click anything to share it.">
        <div className="space-y-0.5">
          {renaming ? (
            <div className="flex items-center gap-2 py-1.5 pl-7">
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={CONTEXT_NAME_MAX_LENGTH}
                placeholder={DEFAULT_CONTEXT_NAME}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveContextName();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <Button variant="pill-primary" onClick={saveContextName} disabled={busy} className="!px-3 !py-1.5 !text-xs">
                Save
              </Button>
              <Button variant="pill-secondary" onClick={() => setRenaming(false)} className="!px-3 !py-1.5 !text-xs">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="group/root flex items-center">
              <div className="min-w-0 flex-1">
                <TreeRow
                  node={{ name: '', path: '', kind: 'folder' }}
                  depth={0}
                  isRoot
                  rootLabel={data.contextName}
                  expanded={false}
                  restricted={restricted}
                  summarize={summarize}
                  onToggle={() => {}}
                  onOpen={() => setShareTarget({ path: '', kind: 'folder' })}
                />
              </div>
              <button
                type="button"
                title="Rename the context"
                onClick={() => {
                  setNameDraft(data.contextName);
                  setRenaming(true);
                }}
                className="ml-1 shrink-0 rounded p-1.5 text-text-muted opacity-0 transition hover:text-text-primary group-hover/root:opacity-100"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {data.tree?.children?.length ? (
            <TreeRows
              nodes={data.tree.children}
              depth={1}
              expandedFolders={expandedFolders}
              restricted={restricted}
              summarize={summarize}
              onToggle={toggleFolder}
              onOpen={(path, kind) => setShareTarget({ path, kind })}
            />
          ) : (
            <p className="px-2 py-1 text-sm text-text-muted">Nothing in the context yet.</p>
          )}
        </div>
      </SettingsSection>

      <details className="group border-t border-border-subtle pt-6">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary [&::-webkit-details-marker]:hidden">
          <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" />
          Advanced
          <span className="font-normal text-text-muted">
            — every grant ({grants.length}), locked folders
          </span>
        </summary>

        <div className="mt-4 space-y-6 pl-1">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Every grant
            </h4>
            {grantsByPath.length === 0 ? (
              <p className="text-sm text-text-muted">No grants yet.</p>
            ) : (
              <div className="space-y-3">
                {grantsByPath.map(([path, pathGrants]) => (
                  <div key={path || '<root>'}>
                    <h5 className="mb-0.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                      {pathLabel(path, data.contextName)}
                    </h5>
                    <div className="space-y-0.5">
                      {pathGrants.map((grant) => (
                        <div key={grant.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1 hover:bg-surface-2">
                          <span className="shrink-0 text-text-muted">
                            <SubjectIcon type={grant.subjectType} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                            {grant.subjectName}
                            {grant.subjectType === 'team' && <span className="text-text-muted"> (team)</span>}
                          </span>
                          <LevelSelect
                            value={levelName(grant.level) ?? 'view'}
                            disabled={busy}
                            allowRemove
                            onRemove={() =>
                              void run(() =>
                                notesApi.accessAction(communityId, { action: 'revoke', grantId: grant.id }),
                              )
                            }
                            onChange={(level) =>
                              void run(() =>
                                notesApi.accessAction(communityId, {
                                  action: 'grant',
                                  subjectType: grant.subjectType,
                                  subjectId: grant.subjectId,
                                  path: grant.resourcePath,
                                  level,
                                }),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Locked folders
            </h4>
            <div className="space-y-0.5">
              {allFolders.map((folder) => (
                <div key={folder.path} className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{folder.path}/</span>
                  <Toggle
                    checked={locked.has(folder.path)}
                    disabled={busy}
                    aria-label={`Lock ${folder.path}`}
                    onChange={(next) =>
                      void run(() =>
                        notesApi.accessAction(communityId, {
                          action: 'setLock',
                          folderPath: folder.path,
                          locked: next,
                        }),
                      )
                    }
                  />
                </div>
              ))}
              {allFolders.length === 0 && <p className="text-sm text-text-muted">No folders.</p>}
            </div>
          </div>
        </div>
      </details>

      {shareTarget !== null && (
        <SharePanel
          communityId={communityId}
          path={shareTarget.path}
          kind={shareTarget.kind}
          title={shareTarget.path === '' ? data.contextName : undefined}
          onClose={() => {
            setShareTarget(null);
            void reload();
          }}
        />
      )}
    </div>
  );
}

type Summarize = (path: string) => { readers: PeopleData['members']; label: string };

/** Recursive tree body: folders (expandable) first, then notes, per level. */
function TreeRows({ nodes, depth, expandedFolders, restricted, summarize, onToggle, onOpen }: {
  nodes: TreeNode[];
  depth: number;
  expandedFolders: Set<string>;
  restricted: Set<string>;
  summarize: Summarize;
  onToggle: (path: string) => void;
  onOpen: (path: string, kind: 'note' | 'folder') => void;
}) {
  const ordered = [...nodes].sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
  );
  return (
    <>
      {ordered.map((node) => {
        const isOpen = node.kind === 'folder' && expandedFolders.has(node.path);
        return (
          <div key={node.path}>
            <TreeRow
              node={node}
              depth={depth}
              expanded={isOpen}
              restricted={restricted}
              summarize={summarize}
              onToggle={() => onToggle(node.path)}
              onOpen={() => onOpen(node.path, node.kind)}
            />
            {isOpen && node.children?.length ? (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expandedFolders={expandedFolders}
                restricted={restricted}
                summarize={summarize}
                onToggle={onToggle}
                onOpen={onOpen}
              />
            ) : isOpen ? (
              <p
                className="py-1 text-xs text-text-muted"
                style={{ paddingLeft: `${(depth + 1) * 24 + 40}px` }}
              >
                Empty folder.
              </p>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** One tree row — expand arrow (folders), icon, name + access summary, avatar
 *  stack (folders), click anywhere else to open the Share dialog. */
function TreeRow({ node, depth, isRoot, rootLabel, expanded, restricted, summarize, onToggle, onOpen }: {
  node: TreeNode;
  depth: number;
  isRoot?: boolean;
  rootLabel?: string;
  expanded: boolean;
  restricted: Set<string>;
  summarize: Summarize;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const isFolder = node.kind === 'folder';
  const summary = summarize(node.path);
  const displayName = isRoot
    ? (rootLabel ?? DEFAULT_CONTEXT_NAME)
    : isFolder
      ? `${node.name}/`
      : (node.title ?? node.name.replace(/\.md$/, ''));
  const shown = isFolder ? summary.readers.slice(0, 4) : [];
  const extra = isFolder ? summary.readers.length - shown.length : 0;
  return (
    <div
      className="group/row flex w-full items-center gap-1.5 rounded-xl pr-3 transition-colors hover:bg-surface-2"
      style={{ paddingLeft: `${depth * 24}px` }}
    >
      {isFolder && !isRoot ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted transition hover:text-text-primary"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
      >
        <span
          className={`flex shrink-0 items-center justify-center rounded-lg text-text-secondary ${
            isFolder ? 'h-8 w-8 bg-surface-2' : 'h-8 w-8'
          }`}
        >
          {isRoot ? (
            <Users className="h-4 w-4" />
          ) : restricted.has(node.path) ? (
            <Lock className="h-4 w-4 text-amber-500" />
          ) : isFolder ? (
            <Folder className="h-4 w-4" />
          ) : (
            <FileText className="h-4 w-4 text-text-muted" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm text-text-primary ${isFolder ? 'font-medium' : ''}`}>
            {displayName}
          </span>
          <span className="block truncate text-xs text-text-muted">{summary.label}</span>
        </span>
        {isFolder && (
          <span className="flex shrink-0 -space-x-2">
            {shown.map((m) => (
              <span key={m.userId} className="rounded-lg ring-2 ring-surface-1">
                <Avatar name={m.user.name} imageUrl={m.user.image} size="xs" />
              </span>
            ))}
            {extra > 0 && (
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-surface-2 text-[10px] font-semibold text-text-secondary ring-2 ring-surface-1">
                +{extra}
              </span>
            )}
          </span>
        )}
        <span className="shrink-0 text-xs font-medium text-text-muted opacity-0 transition-opacity group-hover/row:opacity-100">
          Share
        </span>
      </button>
    </div>
  );
}
