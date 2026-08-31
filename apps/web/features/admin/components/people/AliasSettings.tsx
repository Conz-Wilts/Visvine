'use client';

// Everything an alias is, in the panel `AliasList` opens from its row.
//
// An alias is three things at once — the chip that colours a person in the
// directory, a set of holders, and a set of grants on the context — so it is
// named, coloured, handed out, pointed at content and deleted in one place,
// reached from the row that names it rather than from a screen of its own.
//
// Admin is built in the way the system link types are: you choose who holds it
// and what it reaches, but it cannot be renamed, recoloured, deleted, or stop
// owning the space — so a space can never lose the thing that owns it.
// "Everyone" is the alias every member holds implicitly; it has no membership to
// edit, only access, which is exactly the space-wide grant
// (lib/notes/shared/authz.ts).

import { useState } from 'react';
import { PlusIcon, Trash2Icon, XIcon } from '@/features/shared/icons';
import { Avatar, Button, ColorPicker, ConfirmDialog, Input } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { notesApi } from '@/features/notes/lib/notesApi';
import { aliasNameError, MAX_ALIAS_NAME } from '@/lib/notes/shared/aliases';
import type { AliasInfo } from '@/lib/notes/aliases';
import { GrantEditor, type PeopleData } from './shared';

export type Run = (fn: () => Promise<unknown>) => Promise<void>;

/** Members drawn in the "Give to" menu at once — the rest are found by typing. */
const MAX_CANDIDATES = 50;

interface SettingsProps {
  spaceId: string;
  data: PeopleData;
  busy: boolean;
  run: Run;
}

/** What goes with an alias when it is deleted — read before confirming. */
function deleteBody(holders: number, grants: number) {
  return (
    <>
      {holders > 0 ? (
        <>
          <span className="font-semibold">{holders}</span>{' '}
          {holders === 1 ? 'person holds' : 'people hold'} this alias, and{' '}
        </>
      ) : (
        <>Nobody holds this alias. </>
      )}
      everything it reaches ({grants} {grants === 1 ? 'grant' : 'grants'}) goes with it. Members
      keep whatever their other aliases give them.
    </>
  );
}

/** A titled block inside an alias's settings — "Held by", "Can access". */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h5 className="mb-1.5 text-xs font-medium text-text-muted">{title}</h5>
      {children}
    </div>
  );
}

/**
 * The space-wide grant. Editing it is how "everyone in this space can read
 * the handbook" gets said — there is no membership to edit, since nobody can
 * stop being a member and still be here.
 */
export function EveryoneSettings({ spaceId, data, busy, run }: SettingsProps) {
  const grants = (data.overview?.grants ?? []).filter((g) => g.subjectType === 'space');

  return (
    <Block title="Can access">
      <GrantEditor
        spaceId={spaceId}
        subjectType="space"
        subjectId=""
        grants={grants}
        paths={data.paths}
        contextName={data.contextName}
        busy={busy}
        run={run}
        emptyText="Nothing is open to everyone."
        placeholder="Open something to everyone…"
        addLabel="Add"
      />
    </Block>
  );
}

/**
 * The alias's name, edited the way every other name in the console is: a field
 * that saves itself when you leave it. A rename carries UserAlias, ContextGrant
 * and Node rows with it, so it only fires when the name actually changed and
 * only when it's a name the server will take.
 */
function NameField({ alias, taken, busy, onRename }: {
  alias: AliasInfo;
  taken: string[];
  busy: boolean;
  onRename: (name: string) => void;
}) {
  const [value, setValue] = useState(alias.name);
  const problem = value.trim() === alias.name ? null : aliasNameError(value, taken, alias.name);

  const commit = () => {
    const next = value.trim();
    if (problem || !next || next === alias.name) return;
    onRename(next);
  };

  return (
    <div className="min-w-0 flex-1">
      <Input
        value={value}
        disabled={busy}
        maxLength={MAX_ALIAS_NAME}
        aria-label={`Name of ${alias.name}`}
        className="!py-1 !text-sm"
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') setValue(alias.name);
        }}
      />
      {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
    </div>
  );
}

/**
 * One alias, wide open — in the half of it the screen you are on is about.
 *
 * `naming` is the vocabulary: what the alias is called and coloured, and
 * whether it exists at all. It sits under Types → Person, beside every other
 * type's labels. `permissions` is what holding it MEANS: whether it owns the
 * space, who holds it, and which context folders it opens. That half sits on
 * Members, beside the people wearing it. Two screens, one alias, and neither
 * half repeats the other.
 */
export function AliasSettings({ spaceId, alias, data, busy, run, half }: SettingsProps & {
  alias: AliasInfo;
  half: 'naming' | 'permissions';
}) {
  const [adding, setAdding] = useState(false);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const [color, setColor] = useState(alias.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Grants point at the alias's stable id, so a rename does not orphan them.
  const grants = (data.overview?.grants ?? []).filter(
    (g) => g.subjectType === 'alias' && g.subjectId === alias.id,
  );
  const holderIds = new Set(alias.holders.map((h) => h.userId));
  const candidates = data.members.filter(
    (m) => m.status !== 'pending' && !holderIds.has(m.userId),
  );
  // A space with thousands of members would otherwise hand you a menu of
  // thousands: type to narrow it, and only the head of the list is ever drawn.
  const candidateMatch = candidateQuery.trim().toLowerCase();
  const shownCandidates = (
    candidateMatch
      ? candidates.filter(
          (m) =>
            m.user.name.toLowerCase().includes(candidateMatch) ||
            m.user.email.toLowerCase().includes(candidateMatch),
        )
      : candidates
  ).slice(0, MAX_CANDIDATES);

  const act = (input: Parameters<typeof notesApi.aliasAction>[1]) =>
    void run(() => notesApi.aliasAction(spaceId, input));

  if (half === 'naming') {
    return (
      <div className="space-y-4">
        {/* Name and colour — the alias itself, before who has it. The built-in
            Admin shows the same line with nothing to change: it is what it is,
            and saying so beats hiding the row. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={alias.system || busy}
              onClick={() => setPicking((o) => !o)}
              title={alias.system ? `${alias.name} is built in` : 'Change colour'}
              className="block h-7 w-7 rounded-lg border-2 border-border-default transition-transform hover:scale-110 disabled:cursor-default disabled:hover:scale-100"
              style={{ background: color }}
              aria-label={`Colour of ${alias.name}`}
            />
            {picking && (
              <div className="absolute left-0 top-9 z-50">
                <ColorPicker
                  color={color}
                  onChange={setColor}
                  onClose={() => {
                    setPicking(false);
                    if (color !== alias.color) act({ action: 'update', name: alias.name, color });
                  }}
                />
              </div>
            )}
          </div>
          {alias.system ? (
            <p className="min-w-0 flex-1 text-xs text-text-muted">
              <span className="font-medium text-brand-gold">{alias.name}</span> is built in: it
              can&apos;t be renamed, recoloured or deleted.
            </p>
          ) : (
            <>
              <NameField
                alias={alias}
                taken={data.aliases.map((a) => a.name)}
                busy={busy}
                onRename={(newName) => act({ action: 'update', name: alias.name, newName })}
              />
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={busy}
                title={`Delete ${alias.name}`}
                className="shrink-0 rounded-full p-1 text-text-muted transition hover:text-red-500 disabled:opacity-40"
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        <ConfirmDialog
          open={confirmDelete}
          title={`Delete "${alias.name}"?`}
          body={deleteBody(alias.holders.length, grants.length)}
          confirmLabel="Delete alias"
          destructive
          onConfirm={() => {
            setConfirmDelete(false);
            act({ action: 'delete', name: alias.name });
          }}
          onClose={() => setConfirmDelete(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Standing first: whether holding this alias owns the space is the
          loudest thing it can mean. */}
      <div className="flex flex-wrap items-center gap-3">
        {alias.system ? (
          <p className="min-w-0 flex-1 text-xs text-text-muted">
            <span className="font-medium text-brand-gold">{alias.name}</span> is built in: its
            holders manage this space, and it can&apos;t stop owning it.
          </p>
        ) : (
          <label className="flex shrink-0 items-center gap-2 text-xs text-text-secondary">
            <Toggle
              checked={alias.admin}
              disabled={busy}
              onChange={(admin) => act({ action: 'setAdmin', name: alias.name, admin })}
            />
            Admin of the space
          </label>
        )}
      </div>

      <Block title="Held by">
        <div className="flex flex-wrap items-center gap-1.5">
          {alias.holders.map((holder) => (
            <span
              key={holder.userId}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-1 pr-1 text-xs font-medium text-text-secondary"
            >
              <Avatar name={holder.name} imageUrl={holder.image} size="xs" />
              <span className="max-w-[12rem] truncate">{holder.name}</span>
              <button
                type="button"
                title={`Take ${alias.name} away from ${holder.name}`}
                disabled={busy}
                onClick={() => act({ action: 'removeHolder', name: alias.name, userId: holder.userId })}
                className="rounded-full p-0.5 text-text-muted transition hover:text-red-500 disabled:opacity-40"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
          {alias.holders.length === 0 && <span className="text-xs text-text-muted">Nobody yet.</span>}

          {candidates.length > 0 && (
            <div className="relative">
              <button
                type="button"
                disabled={busy}
                onClick={() => setAdding((o) => !o)}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border-default px-2.5 py-1 text-xs font-medium text-text-muted transition hover:text-text-primary disabled:opacity-40"
              >
                <PlusIcon className="h-3 w-3" /> Give to
              </button>
              {adding && (
                <div className="absolute left-0 top-full z-50 mt-1 flex max-h-72 w-64 flex-col rounded-xl border border-border-subtle bg-surface-1 py-1 shadow-float">
                  {candidates.length > 8 && (
                    <div className="px-2 pb-1 pt-0.5">
                      <Input
                        autoFocus
                        value={candidateQuery}
                        placeholder="Search members…"
                        aria-label={`Search members to give ${alias.name} to`}
                        className="!py-1 !text-xs"
                        onChange={(e) => setCandidateQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }}
                      />
                    </div>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {shownCandidates.map((m) => (
                      <button
                        key={m.userId}
                        type="button"
                        onClick={() => {
                          setAdding(false);
                          setCandidateQuery('');
                          act({ action: 'addHolder', name: alias.name, userId: m.userId });
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2"
                      >
                        {m.user.name}
                      </button>
                    ))}
                    {shownCandidates.length === 0 && (
                      <p className="px-3 py-1.5 text-xs text-text-muted">Nobody matches.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Block>

      <Block title="Can access">
        <GrantEditor
          spaceId={spaceId}
          subjectType="alias"
          subjectId={alias.id}
          grants={grants}
          paths={data.paths}
          contextName={data.contextName}
          busy={busy}
          run={run}
          emptyText="Nothing yet."
          placeholder="Give access to…"
          addLabel="Add"
        />
      </Block>

    </div>
  );
}

/**
 * Create an alias. It starts empty — no holders, no grants, no ownership: what
 * it MEANS is the panel you get by opening it afterwards.
 */
export function NewAliasForm({ spaceId, taken, busy, run, onDone }: {
  spaceId: string;
  taken: string[];
  busy: boolean;
  run: Run;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [picking, setPicking] = useState(false);

  const problem = name.trim() ? aliasNameError(name, taken) : null;

  const create = () => {
    if (!name.trim() || problem) return;
    const value = name.trim();
    onDone();
    void run(() => notesApi.aliasAction(spaceId, { action: 'create', name: value, color }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className="h-8 w-8 rounded-lg border-2 border-border-default transition-transform hover:scale-110"
            style={{ background: color }}
            title="Pick colour"
            aria-label="Pick colour"
          />
          {picking && (
            <div className="absolute left-0 top-10 z-50">
              <ColorPicker color={color} onChange={setColor} onClose={() => setPicking(false)} />
            </div>
          )}
        </div>
        <Input
          autoFocus
          value={name}
          maxLength={MAX_ALIAS_NAME}
          placeholder="Alias name"
          aria-label="New alias name"
          className="!py-1.5 !text-sm"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); create(); }
            if (e.key === 'Escape') onDone();
          }}
        />
      </div>
      {problem && <p className="text-xs text-red-600">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="neutral" onClick={onDone} className="!px-3 !py-1.5 !text-xs">
          Cancel
        </Button>
        <Button
          variant="brand"
          onClick={create}
          disabled={!name.trim() || problem !== null || busy}
          className="!px-3 !py-1.5 !text-xs"
        >
          Create alias
        </Button>
      </div>
    </div>
  );
}
