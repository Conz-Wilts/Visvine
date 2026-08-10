'use client';

// Console → Members. Who is in this community, and who is asking to be.
//
// Deliberately not a permission screen: an alias is shown as the member's type,
// but it is handed out, coloured and pointed at content on Aliases, and access
// requests are resolved there too. Here you can see people, see what they are,
// see when they arrived, and let them in or out. Nothing else.

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Alert, Avatar, Button, ConfirmDialog, SearchInput } from '@/components/ui';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { usePeopleSection } from './PeopleDataContext';
import type { CommunityMember, PeopleData } from './shared';

/** A member's alias, worn as the coloured chip it is everywhere else. */
function AliasChip({ name, color, title }: { name: string; color: string; title?: string }) {
  return (
    <span
      title={title ?? name}
      className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold text-white"
      style={{ background: color }}
    >
      {name}
    </span>
  );
}

/** "7 Feb 2026" — the day someone joined is all this column needs. */
function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PeoplePanel() {
  const { communityId, data, busy, error, setError, run } = usePeopleSection();
  const [tab, setTab] = useState<'active' | 'requests'>('active');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'deny'; userId: string; name: string } | null>(null);

  const members = useMemo(() => data?.members ?? [], [data]);
  const aliases = useMemo(() => data?.aliases ?? [], [data]);

  const pending = useMemo(() => members.filter((m) => m.status === 'pending'), [members]);
  const active = useMemo(() => members.filter((m) => m.status !== 'pending'), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [active, query]);

  // Alias objects per member, resolved once per data load rather than per row
  // per render (search keystrokes retype the whole table).
  const heldByMember = useMemo(() => {
    const byName = new Map(aliases.map((a) => [a.name, a]));
    const map = new Map<string, PeopleData['aliases']>();
    for (const m of members) {
      map.set(m.userId, m.aliases.map((n) => byName.get(n)).filter((a) => a !== undefined));
    }
    return map;
  }, [members, aliases]);

  const approve = (userId: string) =>
    run(() => fetchJsonBody(`/api/communities/${communityId}/members/${userId}`, 'PUT', { status: 'active' }));

  const remove = (userId: string) =>
    run(() => fetchJson(`/api/communities/${communityId}/members/${userId}`, { method: 'DELETE' }));

  // The requests tab only exists while somebody is actually waiting, so a
  // community nobody is knocking on stays a single plain list.
  const showTabs = pending.length > 0;
  const activeTab = showTabs ? tab : 'active';

  return (
    <div className="space-y-5">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {data === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <>
          {showTabs && (
            <div className="flex gap-1 border-b border-border-subtle">
              {([
                ['active', `Members (${active.length})`],
                ['requests', `Requests (${pending.length})`],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`-mb-px border-b-2 px-3 pb-2 text-sm font-medium transition-colors ${
                    activeTab === id
                      ? 'border-brand-green text-text-primary'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'requests' ? (
            <div className="divide-y divide-border-subtle">
              {pending.map((member) => (
                <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.user.name} imageUrl={member.user.image} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-text-primary">{member.user.name}</div>
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
            </div>
          ) : (
            <div className="space-y-4">
              {active.length > 3 && (
                <SearchInput value={query} onChange={setQuery} placeholder="Search members…" />
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-subtle text-left">
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Member</th>
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Type</th>
                      <th className="pb-2 pr-4 text-xs font-normal text-text-muted">Joined</th>
                      <th className="pb-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {filtered.map((member) => (
                      <MemberRow
                        key={member.id}
                        member={member}
                        held={heldByMember.get(member.userId) ?? []}
                        busy={busy}
                        onRemove={() =>
                          setConfirm({ kind: 'remove', userId: member.userId, name: member.user.name })
                        }
                      />
                    ))}
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
          )}
        </>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.kind === 'deny' ? 'Deny join request' : 'Remove member'}
        body={
          confirm?.kind === 'deny' ? (
            <>Deny <span className="font-semibold">{confirm?.name}</span>&apos;s request to join?</>
          ) : (
            <>Are you sure you want to remove <span className="font-semibold">{confirm?.name}</span> from this space? Their aliases and direct grants go with them.</>
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
    </div>
  );
}

/** One member: who they are, what they are, when they arrived, and the way out. */
function MemberRow({ member, held, busy, onRemove }: {
  member: CommunityMember;
  held: PeopleData['aliases'];
  busy: boolean;
  onRemove: () => void;
}) {
  return (
    <tr className="transition hover:bg-surface-2">
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
            {held.map((a) => (
              <AliasChip
                key={a.name}
                name={a.name}
                color={a.color}
                title={a.owner ? `${a.name} — owns the space` : a.name}
              />
            ))}
          </div>
        )}
      </td>
      <td className="py-3 pr-4 whitespace-nowrap text-xs text-text-secondary">
        {joinedLabel(member.joinedAt)}
      </td>
      <td className="py-3 text-right">
        {/* Always visible — removing is a real, named action, not something you
            have to hover to discover. The confirm dialog is the safety net. */}
        <Button
          variant="danger"
          onClick={onRemove}
          disabled={busy}
          className="!inline-flex !items-center !gap-1.5 !px-2.5 !py-1 !text-xs"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      </td>
    </tr>
  );
}
