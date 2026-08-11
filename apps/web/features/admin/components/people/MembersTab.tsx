'use client';

// Members → People. Who is actually in this space.
//
// The row says what someone IS — their name and the aliases they wear — and
// gives you the way out. What an alias MEANS (who else holds it, what it
// reaches) is the Aliases tab next door, so a name is never edited in two
// places.

import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Avatar, Button, Chip, ConfirmDialog, SearchInput } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import { usePeopleSection } from './PeopleDataContext';
import type { CommunityMember, PeopleData } from './shared';

/** "7 Feb 2026" — the day someone joined is all this column needs. */
function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MembersTab() {
  const { communityId, data, busy, run } = usePeopleSection();
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<{ userId: string; name: string } | null>(null);

  const members = useMemo(() => data?.members ?? [], [data]);
  const aliases = useMemo(() => data?.aliases ?? [], [data]);
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

  const remove = (userId: string) =>
    run(() => fetchJson(`/api/communities/${communityId}/members/${userId}`, { method: 'DELETE' }));

  return (
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
                onRemove={() => setConfirm({ userId: member.userId, name: member.user.name })}
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

      <ConfirmDialog
        open={confirm !== null}
        title="Remove member"
        body={
          <>
            Are you sure you want to remove <span className="font-semibold">{confirm?.name}</span> from
            this space? Their aliases and direct grants go with them.
          </>
        }
        confirmLabel="Remove"
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
              <Chip key={a.name} color={a.color} title={a.owner ? `${a.name} — owns the space` : a.name}>
                {a.name}
              </Chip>
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
