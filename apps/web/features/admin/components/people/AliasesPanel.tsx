'use client';

// Console → Aliases: the whole permission system on one screen.
//
// An alias is three things at once — the chip that colours a person in the
// directory, a set of holders, and a set of grants on the context — so it is
// created, named, coloured, handed out, pointed at content and deleted all in
// one place. Nothing about it lives on another page.
//
// Owner leads the list in gold. It is built in the way the system link types
// are: you choose who holds it and what it reaches, but it cannot be renamed,
// recoloured, deleted, or stop owning the community — so a community can never
// lose the thing that owns it. "Everyone" sits above them all as the alias every
// member holds implicitly; it has no membership to edit, only access, which is
// exactly the community-wide grant (lib/notes/shared/authz.ts).

import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Alert, Avatar, Button, ColorPicker, ConfirmDialog, Input, SettingsSection } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { notesApi } from '@/features/notes/lib/notesApi';
import { aliasNameError, MAX_ALIAS_NAME } from '@/lib/notes/shared/aliases';
import type { AliasInfo } from '@/lib/notes/aliases';
import { usePeopleSection } from './PeopleDataContext';
import AccessRequests from './AccessRequests';
import { GrantEditor, type PeopleData } from './shared';

type Run = (fn: () => Promise<unknown>) => Promise<void>;

interface CardProps {
  communityId: string;
  data: PeopleData;
  busy: boolean;
  run: Run;
}

/** The shell every card shares, so Everyone and a real alias read the same. */
function Card({ header, children, gold }: {
  header: React.ReactNode;
  children: React.ReactNode;
  gold?: boolean;
}) {
  return (
    <div
      className={`space-y-4 rounded-2xl border p-4 ${
        gold ? 'border-brand-gold/35 bg-brand-gold-soft/40' : 'border-border-subtle'
      }`}
    >
      {header}
      {children}
    </div>
  );
}

/**
 * The community-wide grant, shown as the alias nobody can leave. Editing its
 * access is how "everyone in this community can read the handbook" gets said.
 */
function EveryoneCard({ communityId, data, busy, run }: CardProps) {
  const grants = (data.overview?.grants ?? []).filter((g) => g.subjectType === 'community');

  return (
    <Card
      header={
        <div>
          <h4 className="text-sm font-semibold text-text-primary">Everyone</h4>
          <p className="text-xs text-text-muted">
            Every member of this space, always. {data.members.length}{' '}
            {data.members.length === 1 ? 'person' : 'people'}.
          </p>
        </div>
      }
    >
      <GrantEditor
        communityId={communityId}
        subjectType="community"
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
    </Card>
  );
}

/** Inline rename field, opened by the pencil beside an alias name. */
function RenameField({ alias, taken, busy, onCancel, onSave }: {
  alias: AliasInfo;
  taken: string[];
  busy: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [value, setValue] = useState(alias.name);
  const problem = value === alias.name ? null : aliasNameError(value, taken, alias.name);
  const submit = () => {
    if (problem || !value.trim()) return;
    if (value.trim() !== alias.name) onSave(value.trim());
    else onCancel();
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          value={value}
          maxLength={MAX_ALIAS_NAME}
          aria-label={`Rename ${alias.name}`}
          className="!py-1 !text-sm"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') onCancel();
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || problem !== null || !value.trim()}
          title="Save"
          className="rounded-full p-1 text-text-muted transition hover:text-brand-green disabled:opacity-40"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          title="Cancel"
          className="rounded-full p-1 text-text-muted transition hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
    </div>
  );
}

function AliasCard({ communityId, alias, data, busy, run }: CardProps & { alias: AliasInfo }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [color, setColor] = useState(alias.color);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const grants = (data.overview?.grants ?? []).filter(
    (g) => g.subjectType === 'alias' && g.subjectId === alias.name,
  );
  const holderIds = new Set(alias.holders.map((h) => h.userId));
  const candidates = data.members.filter(
    (m) => m.status !== 'pending' && !holderIds.has(m.userId),
  );

  const act = (input: Parameters<typeof notesApi.aliasAction>[1]) =>
    void run(() => notesApi.aliasAction(communityId, input));

  return (
    <Card
      gold={alias.system}
      header={
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {/* The same colour the chip wears in the directory. */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  disabled={alias.system || busy}
                  onClick={() => setPicking((o) => !o)}
                  title={alias.system ? `${alias.name} is built in` : 'Change colour'}
                  className="block h-2.5 w-2.5 rounded-full disabled:cursor-default"
                  style={{ background: color }}
                  aria-label={`Colour of ${alias.name}`}
                />
                {picking && (
                  <div className="absolute left-0 top-5 z-50">
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
              {renaming ? (
                <RenameField
                  alias={alias}
                  taken={data.aliases.map((a) => a.name)}
                  busy={busy}
                  onCancel={() => setRenaming(false)}
                  onSave={(newName) => {
                    setRenaming(false);
                    act({ action: 'update', name: alias.name, newName });
                  }}
                />
              ) : (
                <>
                  <h4
                    className={`truncate text-sm font-semibold ${
                      alias.system ? 'text-brand-gold' : 'text-text-primary'
                    }`}
                  >
                    {alias.name}
                  </h4>
                  {!alias.system && (
                    <button
                      type="button"
                      onClick={() => setRenaming(true)}
                      disabled={busy}
                      title={`Rename ${alias.name}`}
                      className="rounded-full p-0.5 text-text-muted opacity-0 transition hover:text-text-primary focus:opacity-100 disabled:opacity-40 group-hover:opacity-100 [.group:hover_&]:opacity-100"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </>
              )}
            </div>
            {!renaming && (
              <p className="truncate text-xs text-text-muted">
                {alias.holders.length} {alias.holders.length === 1 ? 'person' : 'people'}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {alias.system ? (
              <span className="text-xs font-medium text-brand-gold">Owns the space</span>
            ) : (
              <>
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <Toggle
                    checked={alias.owner}
                    disabled={busy}
                    onChange={(owner) => act({ action: 'setOwner', name: alias.name, owner })}
                  />
                  Owns the space
                </label>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  title={`Delete ${alias.name}`}
                  className="rounded-full p-1 text-text-muted transition hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div>
        <h5 className="mb-1.5 text-xs font-medium text-text-muted">Held by</h5>
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
                <X className="h-3 w-3" />
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
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border-default px-2.5 py-1 text-xs font-medium text-text-muted transition hover:text-text-primary disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> Give to
              </button>
              {adding && (
                <div className="absolute left-0 top-full z-50 mt-1 max-h-64 min-w-[200px] overflow-y-auto rounded-xl border border-border-subtle bg-surface-1 py-1 shadow-xl">
                  {candidates.map((m) => (
                    <button
                      key={m.userId}
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        act({ action: 'addHolder', name: alias.name, userId: m.userId });
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-sm text-text-secondary transition-colors hover:bg-surface-2"
                    >
                      {m.user.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <h5 className="mb-1.5 text-xs font-medium text-text-muted">Can access</h5>
        <GrantEditor
          communityId={communityId}
          subjectType="alias"
          subjectId={alias.name}
          grants={grants}
          paths={data.paths}
          contextName={data.contextName}
          busy={busy}
          run={run}
          emptyText="Nothing yet."
          placeholder="Give access to…"
          addLabel="Add"
        />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${alias.name}"?`}
        body={
          <>
            {alias.holders.length > 0 ? (
              <>
                <span className="font-semibold">{alias.holders.length}</span>{' '}
                {alias.holders.length === 1 ? 'person holds' : 'people hold'} this alias, and{' '}
              </>
            ) : (
              <>Nobody holds this alias. </>
            )}
            everything it reaches ({grants.length}{' '}
            {grants.length === 1 ? 'grant' : 'grants'}) goes with it. Members keep
            whatever their other aliases give them.
          </>
        }
        confirmLabel="Delete alias"
        destructive
        onConfirm={() => {
          setConfirmDelete(false);
          act({ action: 'delete', name: alias.name });
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Card>
  );
}

/** Create an alias. It starts empty — no holders, no grants, no ownership. */
function NewAliasRow({ communityId, taken, busy, run }: {
  communityId: string;
  taken: string[];
  busy: boolean;
  run: Run;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6b7280');
  const [picking, setPicking] = useState(false);

  const problem = name.trim() ? aliasNameError(name, taken) : null;

  const reset = () => {
    setOpen(false);
    setName('');
    setColor('#6b7280');
    setPicking(false);
  };

  const create = () => {
    if (!name.trim() || problem) return;
    const value = name.trim();
    reset();
    void run(() => notesApi.aliasAction(communityId, { action: 'create', name: value, color }));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-default px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
      >
        <Plus className="h-3 w-3" /> New alias
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-dashed border-border-default p-4">
      <div className="flex items-center gap-2">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className="h-7 w-7 rounded-lg border-2 border-border-default transition-transform hover:scale-110"
            style={{ background: color }}
            title="Pick colour"
            aria-label="Pick colour"
          />
          {picking && (
            <div className="absolute left-0 top-9 z-50">
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
            if (e.key === 'Escape') reset();
          }}
        />
        <Button
          variant="pill-primary"
          onClick={create}
          disabled={!name.trim() || problem !== null || busy}
          className="!px-3 !py-1.5 !text-xs"
        >
          Create
        </Button>
        <Button variant="pill-secondary" onClick={reset} className="!px-3 !py-1.5 !text-xs">
          Cancel
        </Button>
      </div>
      {problem && <p className="text-xs text-red-600">{problem}</p>}
    </div>
  );
}

export default function AliasesPanel() {
  const { communityId, data, busy, error, setError, run } = usePeopleSection();

  // Owner first, then the rest of the owning aliases, then alphabetical — the
  // server sorts the same way, but re-deriving keeps the list stable on edit.
  const aliases = useMemo(
    () =>
      [...(data?.aliases ?? [])].sort(
        (a, b) =>
          Number(b.system) - Number(a.system) ||
          Number(b.owner) - Number(a.owner) ||
          a.name.localeCompare(b.name),
      ),
    [data],
  );

  return (
    <div className="space-y-8">
      {error && <Alert variant="error" onDismiss={() => setError(null)}>{error}</Alert>}

      {data === null ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : (
        <>
        <AccessRequests />
        <SettingsSection
          title="Aliases"
          description="A person holds any number of these. Together they are everything that person can do here — the chip beside their name, and what they reach in the context."
        >
          <div className="space-y-4">
            <EveryoneCard communityId={communityId} data={data} busy={busy} run={run} />

            {aliases.map((alias) => (
              <div key={alias.name} className="group">
                <AliasCard
                  communityId={communityId}
                  alias={alias}
                  data={data}
                  busy={busy}
                  run={run}
                />
              </div>
            ))}

            <NewAliasRow
              communityId={communityId}
              taken={aliases.map((a) => a.name)}
              busy={busy}
              run={run}
            />
          </div>
        </SettingsSection>
        </>
      )}
    </div>
  );
}
