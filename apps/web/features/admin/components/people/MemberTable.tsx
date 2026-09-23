'use client';

// Who is actually in this space, and what each of them can do.
//
// The row says what someone IS — their name, the aliases they wear, and one line
// for how far they reach into the context. Opening the row is where an admin
// gives them more: flip an alias on or off, see everything that reaches them
// and why (Everyone, an alias, or a grant that is theirs alone), and grant them
// a folder or note directly. What an alias MEANS (its colour, its other holders,
// everything it reaches) belongs to the Person type and is edited on Types, so an
// alias is defined in one place and handed out here.

import { useMemo, useState } from 'react';
import { ChevronRightIcon, Trash2Icon, UsersIcon } from '@/features/shared/icons';
import { Avatar, Button, Chip, ConfirmDialog, SearchInput } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import { formatDate } from '@/lib/date';
import { notesApi } from '@/features/notes/lib/notesApi';
import { levelDisplayLabel, levelName, LEVEL_EDIT } from '@/lib/notes/shared/authz';
import { accessSummary, reachFor, type Reach } from '@/lib/notes/shared/memberAccess';
import { usePeopleSection } from './PeopleDataContext';
import { AliasToggle, GrantEditor, PathLabel, type OverviewGrant, type SpaceMember, type PeopleData } from './shared';

/**
 * How many rows are drawn before the list asks. A space with thousands of
 * members is a page you SEARCH, not one you scroll: the table is a window onto
 * the roll rather than the whole of it, so an admin looking for one person types
 * their name instead of paging to them.
 */
const PAGE = 25;

/** "7 Feb 2026" — the day someone joined is all this column needs. */
function joinedLabel(iso: string): string {
  return Number.isNaN(new Date(iso).getTime()) ? '—' : formatDate(iso);
}

export default function MemberTable() {
  const { spaceId, data, busy, run } = usePeopleSection();
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; name: string } | null>(null);

  const members = useMemo(() => data?.members ?? [], [data]);
  const aliases = useMemo(() => data?.aliases ?? [], [data]);
  const grants = useMemo(() => data?.overview?.grants ?? [], [data]);
  const restricted = useMemo(() => data?.overview?.restricted ?? [], [data]);
  const active = useMemo(() => members.filter((m) => m.status !== 'pending'), [members]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return active;
    return active.filter(
      (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
    );
  }, [active, query]);

  // A search searches everyone, not the drawn rows — so every new query starts
  // its results at the top of a fresh page.
  const search = (next: string) => {
    setQuery(next);
    setShown(PAGE);
    setOpen(null);
  };

  const rows = useMemo(() => filtered.slice(0, shown), [filtered, shown]);
  const hidden = filtered.length - rows.length;

  // Alias objects per drawn member, resolved once per render of the page rather
  // than per row (search keystrokes retype the whole table) — and only for the
  // rows on screen, so the work is a page's worth however big the space is.
  const heldByMember = useMemo(() => {
    const byName = new Map(aliases.map((a) => [a.name, a]));
    const map = new Map<string, PeopleData['aliases']>();
    for (const m of rows) {
      map.set(m.userId, m.aliases.map((n) => byName.get(n)).filter((a) => a !== undefined));
    }
    return map;
  }, [rows, aliases]);

  // Everything that reaches each drawn member, and the one line the row shows.
  const reachByMember = useMemo(() => {
    const map = new Map<string, { reach: Reach<OverviewGrant>[]; summary: string; level: number }>();
    for (const m of rows) {
      const standing = { userId: m.userId, aliases: heldByMember.get(m.userId) ?? [] };
      const { label, level } = accessSummary(grants, standing, restricted);
      map.set(m.userId, { reach: reachFor(grants, standing), summary: label, level });
    }
    return map;
  }, [rows, heldByMember, grants, restricted]);

  const remove = (userId: string) =>
    run(() => fetchJson(`/api/spaces/${spaceId}/members/${userId}`, { method: 'DELETE' }));

  if (!data) return null;

  return (
    <div className="space-y-4">
      {active.length > 8 && (
        <SearchInput value={query} onChange={search} placeholder="Search members…" />
      )}

      {/* No overflow clip on the wrapper: an open row holds the path picker,
          whose menu floats past the table's edge. */}
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line-subtle text-left">
              <th className="pb-2 pr-4 text-xs font-normal text-fg-muted">Member</th>
              <th className="pb-2 pr-4 text-xs font-normal text-fg-muted">Aliases</th>
              <th className="pb-2 pr-4 text-xs font-normal text-fg-muted">Context access</th>
              <th className="pb-2 pr-4 text-xs font-normal text-fg-muted">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((member) => {
              const standing = reachByMember.get(member.userId);
              return (
                <MemberRow
                  key={member.id}
                  member={member}
                  held={heldByMember.get(member.userId) ?? []}
                  summary={standing?.summary ?? 'No access'}
                  level={standing?.level ?? 0}
                  open={open === member.userId}
                  onToggle={() => setOpen((o) => (o === member.userId ? null : member.userId))}
                >
                  <MemberAccess
                    spaceId={spaceId}
                    member={member}
                    data={data}
                    reach={standing?.reach ?? []}
                    busy={busy}
                    run={run}
                    onRemove={() => setConfirm({ userId: member.userId, name: member.user.name })}
                  />
                </MemberRow>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-fg-muted">
                  {query ? 'Nobody matches your search' : 'Nobody here yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hidden > 0 && (
        <div className="flex items-center justify-between gap-3 text-xs text-fg-muted">
          <span>
            {rows.length} of {filtered.length}
            {query ? ' matching' : ''}
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="font-medium text-fg-secondary transition-colors hover:text-fg"
            >
              Show {Math.min(PAGE, hidden)} more
            </button>
            {hidden > PAGE && (
              <button
                type="button"
                onClick={() => setShown(filtered.length)}
                className="transition-colors hover:text-fg"
              >
                Show all {filtered.length}
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={`Remove ${confirm?.name ?? 'member'}?`}
        body="Their aliases and grants go with them."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (!confirm) return;
          const { userId } = confirm;
          setConfirm(null);
          setOpen(null);
          await remove(userId);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}

/**
 * One member: who they are, what they wear, how far they reach, when they
 * arrived — and, opened, everything an admin can change about that.
 */
function MemberRow({ member, held, summary, level, open, onToggle, children }: {
  member: SpaceMember;
  held: PeopleData['aliases'];
  summary: string;
  level: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition ${open ? 'bg-surface-subtle' : 'hover:bg-surface-subtle'}`}
      >
        <td className="py-3 pr-4">
          <div className="flex items-center gap-2.5">
            <ChevronRightIcon
              className={`h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform ${open ? 'rotate-90' : ''}`}
            />
            <Avatar name={member.user.name} imageUrl={member.user.image} size="sm" />
            <div className="min-w-0">
              <div className="truncate font-medium text-fg">{member.user.name}</div>
              <div className="truncate text-xs text-fg-muted">{member.user.email}</div>
            </div>
          </div>
        </td>
        <td className="py-3 pr-4">
          {held.length === 0 ? (
            <span className="text-xs text-fg-muted">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {held.map((a) => (
                <Chip key={a.name} color={a.color} title={a.admin ? `${a.name} — is admin of the space` : a.name}>
                  {a.name}
                </Chip>
              ))}
            </div>
          )}
        </td>
        <td className="py-3 pr-4 whitespace-nowrap text-xs">
          {held.some((a) => a.admin) ? (
            <span className="text-admin">Admin — everything</span>
          ) : (
            <span className={level >= LEVEL_EDIT ? 'text-fg' : level > 0 ? 'text-fg-secondary' : 'text-fg-muted'}>
              {summary}
            </span>
          )}
        </td>
        <td className="py-3 whitespace-nowrap text-xs text-fg-secondary">
          {joinedLabel(member.joinedAt)}
        </td>
      </tr>
      {open && (
        <tr className="bg-surface-subtle/60">
          <td colSpan={4} className="px-2 pb-5 pt-1 sm:px-9">
            {children}
          </td>
        </tr>
      )}
    </>
  );
}

/** A titled block inside the open row — "Aliases", "Can access". */
function Block({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="mb-1.5 text-xs font-medium text-fg-muted">
        {title}
        {hint && <span className="ml-1.5 font-normal opacity-80">{hint}</span>}
      </h5>
      {children}
    </div>
  );
}

/** "via Everyone" / "via Research" — where a grant that is not theirs came from. */
function ViaChip({ via }: { via: Reach['via'] }) {
  if (via.kind === 'everyone') {
    return (
      <Chip size="xs" tone="muted" title="Every member of this space has this">
        <UsersIcon className="mr-1 inline h-3 w-3 opacity-70" />
        Everyone
      </Chip>
    );
  }
  if (via.kind === 'alias') {
    return (
      <Chip size="xs" color={via.color} title={`Comes with the ${via.name} alias`}>
        {via.name}
      </Chip>
    );
  }
  return null;
}

/**
 * The whole of one person's standing, editable: the aliases they hold, what
 * reaches them through those and through Everyone (read-only here — change it
 * in the alias's own panel, where it changes for every holder), the grants that are
 * theirs alone, and the way out.
 */
function MemberAccess({ spaceId, member, data, reach, busy, run, onRemove }: {
  spaceId: string;
  member: SpaceMember;
  data: PeopleData;
  reach: Reach<OverviewGrant>[];
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onRemove: () => void;
}) {
  const held = new Set(member.aliases);
  const inherited = reach.filter((r) => r.via.kind !== 'direct');
  const direct = reach.filter((r) => r.via.kind === 'direct').map((r) => r.grant);
  const isAdmin = data.aliases.some((a) => a.admin && held.has(a.name));

  const toggleAlias = (name: string) =>
    void run(() =>
      notesApi.aliasAction(spaceId, {
        action: held.has(name) ? 'removeHolder' : 'addHolder',
        name,
        userId: member.userId,
      }),
    );

  return (
    <div className="space-y-4">
      <Block title="Aliases" hint="— click to give or take away">
        {data.aliases.length === 0 ? (
          <p className="text-xs text-fg-muted">This space has no aliases yet. Make one on Types, under Person.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {data.aliases.map((alias) => (
              <AliasToggle
                key={alias.name}
                name={alias.name}
                color={alias.color}
                admin={alias.admin}
                on={held.has(alias.name)}
                disabled={busy}
                onClick={() => toggleAlias(alias.name)}
              />
            ))}
          </div>
        )}
      </Block>

      <Block title="Can access" hint={isAdmin ? '— an admin reaches everything, whatever is listed here' : undefined}>
        <div className="space-y-1">
          {inherited.map(({ grant, via }) => (
            <div
              key={grant.id}
              className="flex items-center gap-2.5 rounded-lg px-1 py-1 text-sm text-fg"
            >
              <PathLabel path={grant.resourcePath} contextName={data.contextName} paths={data.paths} />
              <ViaChip via={via} />
              <span className="w-16 shrink-0 text-right text-xs font-medium text-fg-secondary">
                {levelDisplayLabel(levelName(grant.level))}
              </span>
            </div>
          ))}
          {inherited.length === 0 && direct.length === 0 && !isAdmin && (
            <p className="px-1 text-xs text-fg-muted">
              Nothing reaches {member.user.name.split(' ')[0]} yet — give them an alias above, or a folder or note below.
            </p>
          )}
        </div>
      </Block>

      <Block title="Just for them">
        <GrantEditor
          spaceId={spaceId}
          subjectType="user"
          subjectId={member.userId}
          grants={direct}
          paths={data.paths}
          contextName={data.contextName}
          busy={busy}
          run={run}
          emptyText="Nothing yet."
          placeholder="Give them a folder or note…"
          addLabel="Give"
        />
      </Block>

      <div className="flex justify-end pt-1">
        <Button
          variant="danger"
          onClick={onRemove}
          disabled={busy}
          className="!inline-flex !items-center !gap-1.5 !px-2.5 !py-1 !text-xs"
        >
          <Trash2Icon className="h-3.5 w-3.5" />
          Remove from space
        </Button>
      </div>
    </div>
  );
}
