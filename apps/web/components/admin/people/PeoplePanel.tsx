'use client';

// Console → People. Who is here, and who is waiting to be.
//
// A member row shows only what they hold and what that reaches — there is no
// role to set, because standing IS the alias list. Expanding a row gives the
// full set of the community's aliases as checkboxes (tick any, in any
// combination) plus their direct one-off grants.
//
// Inviting lives on its own section (InvitePanel); the aliases themselves are
// created on Aliases. This page is only about the people.

import { useMemo, useState } from 'react';
import { ChevronDown, FileText, Folder, Users } from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  SearchInput,
  SettingsSection,
} from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { describeOutcome, requestTargetLabel } from '@/lib/notes/shared/accessRequests';
import { levelName, type AccessLevelName } from '@/lib/notes/shared/authz';
import type { AccessRequest } from '@/lib/notes/shared/brainTypes';
import { usePeopleSection } from './PeopleDataContext';
import {
  accessOfMember,
  levelLabel,
  pathLabel,
  summarizeAccess,
  AliasToggle,
  GrantEditor,
  LevelSelect,
  type CommunityMember,
  type PeopleData,
} from './shared';

type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** "3 hours ago" without pulling in a date library. */
function relativeTime(epochMs: number): string {
  const mins = Math.round((Date.now() - epochMs) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function TargetChip({ path, contextName }: { path: string; contextName: string }) {
  const Icon = path === '' ? Users : path.endsWith('.md') ? FileText : Folder;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 align-middle text-[11px] font-medium text-text-secondary">
      <Icon className="h-3 w-3 shrink-0 opacity-70" />
      <span className="truncate">{requestTargetLabel(path, contextName)}</span>
    </span>
  );
}

/** The expanded per-member editor under a member row. */
function MemberDetail({ communityId, member, data, busy, run, onRemove }: {
  communityId: string;
  member: CommunityMember;
  data: PeopleData;
  busy: boolean;
  run: Run;
  onRemove: () => void;
}) {
  const held = new Set(member.aliases);
  const manages = data.aliases.some((a) => a.owner && held.has(a.name));
  const direct = (data.overview?.grants ?? []).filter(
    (g) => g.subjectType === 'user' && g.subjectId === member.userId,
  );
  const inherited = (data.overview?.grants ?? []).filter(
    (g) => g.subjectType === 'community' || (g.subjectType === 'alias' && held.has(g.subjectId)),
  );
  const access = accessOfMember(member.userId, data.aliases, data.overview);

  const toggleAlias = (name: string) =>
    void run(() =>
      notesApi.aliasAction(communityId, {
        action: held.has(name) ? 'removeHolder' : 'addHolder',
        name,
        userId: member.userId,
      }),
    );

  return (
    <div className="space-y-5 rounded-xl bg-surface-2/60 px-4 py-4">
      <div>
        <h5 className="mb-1.5 text-xs font-medium text-text-muted">Aliases</h5>
        {data.aliases.length === 0 ? (
          <p className="text-xs text-text-muted">None yet — create one on the Aliases page.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.aliases.map((alias) => (
              <AliasToggle
                key={alias.name}
                name={alias.name}
                owner={alias.owner}
                system={alias.system}
                on={held.has(alias.name)}
                disabled={busy}
                onClick={() => toggleAlias(alias.name)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h5 className="mb-1.5 text-xs font-medium text-text-muted">Just for them</h5>
        <GrantEditor
          communityId={communityId}
          subjectType="user"
          subjectId={member.userId}
          grants={direct}
          paths={data.paths}
          contextName={data.contextName}
          busy={busy}
          run={run}
          emptyText="None."
          placeholder="Give access to…"
          addLabel="Add"
        />
      </div>

      {inherited.length > 0 && !manages && (
        <div>
          <h5 className="mb-1.5 text-xs font-medium text-text-muted">From their aliases</h5>
          <div className="space-y-0.5">
            {inherited.map((grant) => (
              <div key={grant.id} className="flex items-center gap-2.5 px-1 py-1 text-sm">
                <span className="min-w-0 flex-1 truncate text-text-primary">{pathLabel(grant.resourcePath, data.contextName)}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  via {grant.subjectType === 'community' ? 'everyone' : grant.subjectName}
                </span>
                <span className="w-20 shrink-0 text-right text-xs font-medium text-text-secondary">
                  {levelLabel(grant.level)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
        <p className="text-xs text-text-muted">
          Reaches: <span className="font-medium text-text-secondary">{summarizeAccess(manages, access)}</span>
        </p>
        <Button variant="pill-danger" onClick={onRemove} disabled={busy} className="!px-3 !py-1.5 !text-xs">
          Remove from community
        </Button>
      </div>
    </div>
  );
}

export default function PeoplePanel() {
  const { communityId, data, busy, error, setError, run } = usePeopleSection();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'deny'; userId: string; name: string } | null>(null);
  const [denyRequest, setDenyRequest] = useState<AccessRequest | null>(null);
  // Level chosen per access request before approving; absent = what was asked for.
  const [levels, setLevels] = useState<Record<string, AccessLevelName>>({});

  const members = useMemo(() => data?.members ?? [], [data]);
  const requests = useMemo(() => data?.requests ?? [], [data]);
  const aliases = useMemo(() => data?.aliases ?? [], [data]);
  const overview = data?.overview ?? null;

  const pendingMembers = useMemo(() => members.filter((m) => m.status === 'pending'), [members]);
  const pendingRequests = useMemo(() => requests.filter((r) => r.status === 'pending'), [requests]);
  const resolved = useMemo(() => requests.filter((r) => r.status !== 'pending').slice(0, 5), [requests]);
  const active = useMemo(() => members.filter((m) => m.status !== 'pending'), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [active, query]);

  // Alias names + effective-access summary per member, computed once per data
  // load instead of per row per render (search keystrokes, expands).
  const memberInfo = useMemo(() => {
    const map = new Map<string, { held: PeopleData['aliases']; summary: string }>();
    const byName = new Map(aliases.map((a) => [a.name, a]));
    for (const m of members) {
      const mine = m.aliases.map((n) => byName.get(n)).filter((a) => a !== undefined);
      map.set(m.userId, {
        held: mine,
        summary: summarizeAccess(
          mine.some((a) => a.owner),
          accessOfMember(m.userId, aliases, overview),
        ),
      });
    }
    return map;
  }, [members, aliases, overview]);

  const approve = (userId: string) =>
    run(() => fetchJsonBody(`/api/communities/${communityId}/members/${userId}`, 'PUT', { status: 'active' }));

  const remove = (userId: string) =>
    run(() => fetchJson(`/api/communities/${communityId}/members/${userId}`, { method: 'DELETE' }));

  const resolveRequest = (request: AccessRequest, approveIt: boolean) =>
    run(() =>
      notesApi.resolveAccessRequest(
        communityId,
        request.id,
        approveIt,
        approveIt ? (levels[request.id] ?? levelName(request.level) ?? 'view') : undefined,
      ),
    );

  const waiting = pendingMembers.length + pendingRequests.length;
  const contextName = data?.contextName ?? '';

  return (
    <div className="space-y-8">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {data === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <>
          {waiting > 0 && (
            <SettingsSection title={`Waiting (${waiting})`}>
              <div className="divide-y divide-border-subtle">
                {pendingMembers.map((member) => (
                  <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={member.user.name} imageUrl={member.user.image} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                          <span className="font-medium text-text-primary">{member.user.name}</span>
                          <span className="text-text-muted">wants to join</span>
                        </div>
                        <div className="truncate text-xs text-text-muted">{member.user.email}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="pill-primary"
                        onClick={() => void approve(member.userId)}
                        disabled={busy}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="pill-secondary"
                        onClick={() => setConfirm({ kind: 'deny', userId: member.userId, name: member.user.name })}
                        disabled={busy}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                ))}

                {pendingRequests.map((request) => (
                  <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Avatar name={request.requesterName ?? 'Member'} imageUrl={request.requesterImage ?? null} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                          <span className="font-medium text-text-primary">{request.requesterName ?? 'Member'}</span>
                          <span className="text-text-muted">wants access to</span>
                          <TargetChip path={request.resourcePath} contextName={contextName} />
                          <span className="text-xs text-text-muted">· {relativeTime(request.requestedAt)}</span>
                        </div>
                        {request.message && (
                          <p className="mt-1 border-l-2 border-border-default pl-2 text-xs italic text-text-secondary">
                            {request.message}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <LevelSelect
                        value={levels[request.id] ?? levelName(request.level) ?? 'view'}
                        onChange={(level) => setLevels((prev) => ({ ...prev, [request.id]: level }))}
                        disabled={busy}
                      />
                      <Button
                        variant="pill-primary"
                        onClick={() => void resolveRequest(request, true)}
                        disabled={busy}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="pill-secondary"
                        onClick={() => setDenyRequest(request)}
                        disabled={busy}
                        className="!px-3 !py-1.5 !text-xs"
                      >
                        Deny
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              {resolved.length > 0 && (
                <div className="mt-4 space-y-1.5 border-t border-border-subtle pt-3">
                  {resolved.map((request) => (
                    <div key={request.id} className="flex items-center gap-2 text-xs text-text-muted">
                      <span
                        className={`inline-flex h-5 shrink-0 items-center rounded-full px-2 font-semibold ${
                          request.status === 'approved'
                            ? 'bg-brand-green/15 text-brand-green'
                            : 'bg-surface-2 text-text-muted'
                        }`}
                      >
                        {request.status === 'approved' ? 'Approved' : 'Denied'}
                      </span>
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-text-secondary">{request.requesterName ?? 'Member'}</span>
                        {' · '}
                        {describeOutcome(request, contextName)}
                        {request.resolvedAt && <> · {relativeTime(request.resolvedAt)}</>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </SettingsSection>
          )}

          <SettingsSection title={`People (${active.length})`}>
            <div className="space-y-4">
              {active.length > 3 && (
                <SearchInput value={query} onChange={setQuery} placeholder="Search people…" />
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left">
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Person</th>
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Aliases</th>
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Reaches</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {filtered.map((member) => {
                      const info = memberInfo.get(member.userId);
                      const isOpen = expanded === member.userId;
                      return (
                        <MemberRows
                          key={member.id}
                          member={member}
                          held={info?.held ?? []}
                          summary={info?.summary ?? ''}
                          isOpen={isOpen}
                          onToggle={() => setExpanded(isOpen ? null : member.userId)}
                          detail={
                            isOpen ? (
                              <MemberDetail
                                communityId={communityId}
                                member={member}
                                data={data}
                                busy={busy}
                                run={run}
                                onRemove={() => setConfirm({ kind: 'remove', userId: member.userId, name: member.user.name })}
                              />
                            ) : null
                          }
                        />
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-sm text-text-muted">
                          {query ? 'Nobody matches your search' : 'Nobody here yet'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </SettingsSection>
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'deny' ? 'Deny join request' : 'Remove person'}
        body={
          confirm?.kind === 'deny' ? (
            <>Deny <span className="font-semibold">{confirm?.name}</span>&apos;s request to join?</>
          ) : (
            <>Remove <span className="font-semibold">{confirm?.name}</span> from this community? Their aliases and direct grants go with them.</>
          )
        }
        confirmLabel={confirm?.kind === 'deny' ? 'Deny' : 'Remove'}
        destructive
        onConfirm={async () => {
          if (!confirm) return;
          const { userId } = confirm;
          setConfirm(null);
          await remove(userId);
        }}
        onClose={() => setConfirm(null)}
      />

      <ConfirmDialog
        open={denyRequest !== null}
        title="Deny this request?"
        body={
          denyRequest && (
            <>
              {denyRequest.requesterName ?? 'This member'} won’t get access to{' '}
              <span className="font-medium text-text-primary">
                {requestTargetLabel(denyRequest.resourcePath, contextName)}
              </span>
              . They can ask again.
            </>
          )
        }
        confirmLabel="Deny request"
        destructive
        onConfirm={async () => {
          const request = denyRequest;
          setDenyRequest(null);
          if (request) await resolveRequest(request, false);
        }}
        onClose={() => setDenyRequest(null)}
      />
    </div>
  );
}

/** A person's main row + (when expanded) its detail row. */
function MemberRows({ member, held, summary, isOpen, onToggle, detail }: {
  member: CommunityMember;
  held: PeopleData['aliases'];
  summary: string;
  isOpen: boolean;
  onToggle: () => void;
  detail: React.ReactNode;
}) {
  return (
    <>
      <tr className="cursor-pointer transition hover:bg-surface-2" onClick={onToggle}>
        <td className="py-3 pr-4">
          <div className="flex items-center gap-3">
            <Avatar name={member.user.name} imageUrl={member.user.image} size="sm" />
            <div className="min-w-0">
              <div className="truncate font-medium text-text-primary">{member.user.name}</div>
              <div className="truncate text-xs text-text-muted">{member.user.email}</div>
            </div>
          </div>
        </td>
        <td className="py-3 pr-4">
          {held.length === 0 ? (
            <span className="text-xs text-text-muted">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {held.slice(0, 3).map((a) => (
                <span
                  key={a.name}
                  title={a.owner ? `${a.name} — owns the community` : a.name}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    a.system
                      ? 'bg-brand-gold text-white'
                      : 'bg-surface-2 text-text-secondary'
                  }`}
                >
                  {a.name}
                </span>
              ))}
              {held.length > 3 && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-text-muted">
                  +{held.length - 3}
                </span>
              )}
            </div>
          )}
        </td>
        <td className="py-3 pr-4 text-xs text-text-secondary">{summary}</td>
        <td className="py-3 text-right">
          {/* Remove lives inside the expanded detail — the row itself is just a
              summary, so nothing destructive sits one stray click away. */}
          <span
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            className="inline-block rounded p-1 text-text-muted"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={4} className="pb-4 pt-1">
            {detail}
          </td>
        </tr>
      )}
    </>
  );
}
