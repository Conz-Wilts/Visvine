'use client';

// A Person's aliases, as a list of rows — and, when you open one, the half of
// that alias this screen is about, in place of the list.
//
// The same list is drawn twice, because an alias is two things at once. Under
// Types → Person it is VOCABULARY: what a person can be called and coloured,
// beside every other type's labels, and where one is made and unmade.  At the
// foot of Console → Members it is the PERMISSION MODEL: who holds it, whether
// holding it owns the space, and which context folders it opens — beside the
// people wearing it. One alias, two screens, and neither repeats the other.
//
// The row reads like a line of the Types list — colour, name, who holds it,
// what it opens, and a Permissions cog — and what it opens replaces the list
// rather than floating over it: you clicked into an alias, and Back is how you
// come out. Both surfaces use AliasRow and AliasBackRow, so the drill-down
// reads the same either way.

import { useMemo, useState } from 'react';
import { TreeSpine, TreeSpineJoin, type TreeGuideKind } from '@/components/ui/TreeChrome';
import { ChevronLeftIcon, PlusIcon, SettingsIcon } from '@/features/shared/icons';
import type { AliasInfo } from '@/lib/notes/aliases';
import { AliasSettings, EveryoneSettings, NewAliasForm } from './AliasSettings';
import { usePeopleSection } from './PeopleDataContext';

/** What the panel is showing: an alias, the implicit Everyone, or the create form. */
type Open = { kind: 'alias'; id: string } | { kind: 'everyone' } | { kind: 'new' } | null;

/** "4 people" / "1 person". */
function peopleCount(n: number): string {
  return `${n} ${n === 1 ? 'person' : 'people'}`;
}

/** "3 folders" / "1 folder" — what the alias opens in the context. */
function grantCount(n: number): string {
  return n === 0 ? 'no folders' : `${n} ${n === 1 ? 'folder' : 'folders'}`;
}

/** Everyone first (nobody can leave it), then Admin in gold, then the rest. */
function sortAliases(aliases: AliasInfo[]): AliasInfo[] {
  return [...aliases].sort(
    (a, b) =>
      Number(b.system) - Number(a.system) ||
      Number(b.admin) - Number(a.admin) ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The way back out of one alias to the type's own settings, with the alias you
 * are inside named beside it.
 */
export function AliasBackRow({ label, onBack, children }: {
  label: string;
  onBack: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1.5 inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary"
      >
        <ChevronLeftIcon className="h-3.5 w-3.5" />
        {label}
      </button>
      {children}
    </div>
  );
}

/**
 * The line that starts a new alias, at the head of the list it adds to and
 * shaped like the lines under it — an empty swatch where a colour will be, and
 * the name it will have in its place.
 */
export function NewAliasRow({ nested, onClick }: { nested?: TreeGuideKind; onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
      className="flex cursor-pointer items-center gap-3.5 py-2.5 text-text-muted transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      {nested && <TreeSpineJoin kind={nested} />}
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded border border-dashed border-border-default">
        <PlusIcon className="h-2.5 w-2.5" />
      </span>
      <span className="text-base font-medium">Create new alias</span>
    </div>
  );
}

/**
 * An alias named the way its type is named on the row above: its colour as a
 * swatch, then the word. A chip is a tag on a card; this is a line of a list,
 * and the list already reads down the swatches.
 */
export function AliasLabel({ name, color, muted, size = 'alias' }: {
  name: string;
  color?: string;
  /** The word in the secondary weight — an alias under the type it belongs to. */
  muted?: boolean;
  /** `type` matches the line above it; `alias` is deliberately a size down, so
      a glance says these are the things the type can wear, not more types. */
  size?: 'type' | 'alias';
}) {
  const type = size === 'type';
  return (
    <span className={`inline-flex min-w-0 items-center ${type ? 'gap-3.5' : 'gap-3'}`}>
      <span
        className={`${type ? 'h-5 w-5' : 'h-4 w-4'} shrink-0 rounded`}
        style={{ background: color ?? 'var(--color-text-muted)' }}
        aria-hidden
      />
      <span
        className={`truncate text-base ${
          muted ? 'font-medium text-text-secondary' : 'font-semibold text-text-primary'
        }`}
      >
        {name}
      </span>
    </span>
  );
}

/**
 * One alias as a line you read, the same line the Types list is made of: its
 * colour and name, what it means, then the cog that opens everything you can
 * change about it. A row rather than a chip because an alias is not a tag here
 * — it is who somebody is and what they can open, and neither fits inside a
 * chip.
 */
export function AliasRow({ label, meta, action = 'Permissions', nested, onOpen }: {
  label: React.ReactNode;
  /** Inside a TreeSpine: which piece of the line this row draws. */
  nested?: TreeGuideKind;
  /** What the alias is, in a phrase — holders and folders, or what it labels. */
  meta: string;
  /** The cog, and what it opens. `null` for an alias with no permissions to
      open — a label on a card is edited by clicking the row, and a cog on it
      would promise a permission model that only Person has. */
  action?: string | null;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); }
      }}
      className={`flex cursor-pointer items-center gap-3.5 transition-colors hover:bg-surface-2 ${
        nested ? 'py-2.5' : 'py-4'
      }`}
    >
      {nested && <TreeSpineJoin kind={nested} />}
      <span className={`${nested ? '' : 'ml-1 '}min-w-0 shrink truncate`}>{label}</span>
      {/* Two numbers, and they are the two halves of what the alias IS: who
          holds it, and what holding it opens. Holders' names belong in the
          panel — a row that truncates them says less than one that doesn't
          try. */}
      <span className="flex-1 whitespace-nowrap text-xs text-text-muted">{meta}</span>
      {action && (
        <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary">
          <SettingsIcon className="h-3.5 w-3.5" />
          {action}
        </span>
      )}
    </div>
  );
}

export default function AliasList({ mode, typeColor, newOpen, onNewStart, onNewDone }: {
  /** Which half of every alias this list opens — see the note at the top. */
  mode: 'naming' | 'permissions';
  /** Start an alias. Naming half only — Members hands them out, Types makes them. */
  onNewStart?: () => void;
  /** The Person type's own colour, so the row at the head of the list wears
      the same swatch the Types list paints it with. */
  typeColor?: string;
  /** The create form, opened from the type's own row — "New alias" sits beside
      the type it makes one of, so the list underneath is only the list. */
  newOpen?: boolean;
  onNewDone?: () => void;
}) {
  const { spaceId, data, busy, run } = usePeopleSection();
  const [open, setOpen] = useState<Open>(null);

  const aliases = useMemo(() => sortAliases(data?.aliases ?? []), [data]);

  // How many folders each alias opens, off the same grant overview the panel
  // edits. It is on the row because it is the thing this screen is FOR: hand
  // somebody an alias and they get the context that comes with it, so the row
  // has to say what that is before you open it.
  const grantsByAlias = useMemo(() => {
    const counts = new Map<string, number>();
    for (const grant of data?.overview?.grants ?? []) {
      if (grant.subjectType !== 'alias') continue;
      counts.set(grant.subjectId, (counts.get(grant.subjectId) ?? 0) + 1);
    }
    return counts;
  }, [data]);
  const everyoneGrants = (data?.overview?.grants ?? []).filter((g) => g.subjectType === 'space').length;

  if (data === null) return <p className="text-xs text-text-muted">Loading…</p>;

  // Read back off the fresh snapshot every render: a rename or a delete inside
  // the panel reloads the lot, and the panel has to follow rather than hold a
  // copy of the alias it was opened with. Keyed on the alias's id, not its name,
  // so renaming one doesn't shut it — grants point at the id for the same
  // reason. An alias gone from the snapshot closes the panel.
  const showing = open?.kind === 'alias' ? aliases.find((a) => a.id === open.id) : undefined;
  const opened: Open = newOpen ? { kind: 'new' } : open;
  const panel: Open = opened?.kind === 'alias' && !showing ? null : opened;
  const close = () => { setOpen(null); onNewDone?.(); };

  if (panel?.kind === 'new') {
    return (
      <div>
        <AliasBackRow label="Aliases" onBack={close} />
        <NewAliasForm
          spaceId={spaceId}
          taken={aliases.map((a) => a.name)}
          busy={busy}
          run={run}
          onDone={close}
        />
      </div>
    );
  }

  if (panel?.kind === 'everyone') {
    return (
      <div>
        <AliasBackRow label="Aliases" onBack={close}>
          <AliasLabel name="Person" color={typeColor} />
          <span className="text-xs text-text-muted">every member of this space, always</span>
        </AliasBackRow>
        <EveryoneSettings spaceId={spaceId} data={data} busy={busy} run={run} />
      </div>
    );
  }

  if (panel?.kind === 'alias' && showing) {
    return (
      <div>
        <AliasBackRow label="Aliases" onBack={close}>
          <AliasLabel name={showing.name} color={showing.color} />
          <span className="text-xs text-text-muted">
            {peopleCount(showing.holders.length)} · {grantCount(grantsByAlias.get(showing.id) ?? 0)}
          </span>
        </AliasBackRow>
        <AliasSettings
          spaceId={spaceId}
          alias={showing}
          data={data}
          busy={busy}
          run={run}
          half={mode}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Only the permissions half has a Person row: there is nothing to NAME
          about being a person, and what it opens is the space-wide grant that
          reaches every member. Under Types the row above this list is the type
          itself, so the guides hang off that instead. */}
      {mode === 'permissions' && (
        <AliasRow
          label={<AliasLabel name="Person" color={typeColor} size="type" />}
          meta={`${peopleCount(data.members.length)} · ${grantCount(everyoneGrants)}`}
          onOpen={() => setOpen({ kind: 'everyone' })}
        />
      )}

      <TreeSpine animate>
        {mode === 'naming' && onNewStart && (
          <NewAliasRow nested={aliases.length === 0 ? 'last' : 'mid'} onClick={onNewStart} />
        )}
        {aliases.map((alias, i) => (
          <AliasRow
            key={alias.id}
            nested={i === aliases.length - 1 ? 'last' : 'mid'}
            label={<AliasLabel name={alias.name} color={alias.color} muted />}
            meta={mode === 'permissions'
              ? `${peopleCount(alias.holders.length)} · ${grantCount(grantsByAlias.get(alias.id) ?? 0)}`
              : ''}
            action={mode === 'permissions' ? 'Permissions' : null}
            onOpen={() => setOpen({ kind: 'alias', id: alias.id })}
          />
        ))}
      </TreeSpine>
    </div>
  );
}
