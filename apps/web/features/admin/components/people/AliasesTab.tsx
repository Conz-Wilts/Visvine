'use client';

// Members → Aliases. The permission model itself.
//
// An alias is the only thing in this space that grants anything: it is the chip
// beside a person's name, the set of people wearing it, and the set of paths it
// reaches. Types describes what KINDS of thing the space records; this is who can
// do what, so it lives beside the people it applies to rather than under the
// Person type it happens to be spelled on.

import { useMemo, useState } from 'react';
import { Settings2Icon } from '@/features/shared/icons';
import { Chip } from '@/components/ui';
import { AliasSettings, EveryoneSettings, NewAliasRow } from './AliasSettings';
import { usePeopleSection } from './PeopleDataContext';

/** The subject whose settings are open; '' = Everyone, null = none. */
type OpenSubject = string | null;

/**
 * One row in the alias list: the chip as it appears everywhere else, how many
 * people wear it, and the cog that opens what it means.
 */
function PermissionRow({ name, color, tone, detail, open, onToggle, children }: {
  name: string;
  color?: string;
  tone: 'solid' | 'muted';
  detail: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 py-2">
        <Chip size="md" tone={tone} color={color}>{name}</Chip>
        <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{detail}</span>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={`${open ? 'Close' : 'Open'} ${name} settings`}
          className={`shrink-0 rounded-lg p-1.5 transition-colors ${
            open ? 'bg-surface-3 text-text-primary' : 'text-text-muted hover:bg-surface-3 hover:text-text-primary'
          }`}
        >
          <Settings2Icon className="h-4 w-4" />
        </button>
      </div>
      {open && <div className="pb-4 pl-1 pr-1">{children}</div>}
    </div>
  );
}

/**
 * Everyone first (the alias nobody can leave), then Admin in gold, then the rest.
 * The shared People snapshot is the source, so a rename or a new holder shows up
 * on the People tab, on Invite and on Types at the same moment.
 */
export default function AliasesTab() {
  const { spaceId, data, busy, run } = usePeopleSection();
  const [open, setOpen] = useState<OpenSubject>(null);

  const aliases = useMemo(
    () =>
      [...(data?.aliases ?? [])].sort(
        (a, b) =>
          Number(b.system) - Number(a.system) ||
          Number(b.admin) - Number(a.admin) ||
          a.name.localeCompare(b.name),
      ),
    [data],
  );

  if (data === null) return <p className="py-2 text-xs text-text-muted">Loading…</p>;

  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        A person holds any number of these. Together they are everything that person can do here —
        the chip beside their name, and what they reach in the context.
      </p>

      <div className="divide-y divide-border-subtle">
        <PermissionRow
          name="Everyone"
          tone="muted"
          detail={`Every member of this space, always. ${data.members.length} ${data.members.length === 1 ? 'person' : 'people'}.`}
          open={open === ''}
          onToggle={() => toggle('')}
        >
          <EveryoneSettings spaceId={spaceId} data={data} busy={busy} run={run} />
        </PermissionRow>

        {aliases.map((alias) => (
          <PermissionRow
            key={alias.name}
            name={alias.name}
            color={alias.color}
            tone="solid"
            detail={`${alias.holders.length} ${alias.holders.length === 1 ? 'person' : 'people'}${alias.admin ? ' · is admin of the space' : ''}`}
            open={open === alias.name}
            onToggle={() => toggle(alias.name)}
          >
            <AliasSettings
              spaceId={spaceId}
              alias={alias}
              data={data}
              busy={busy}
              run={run}
            />
          </PermissionRow>
        ))}
      </div>

      <NewAliasRow
        spaceId={spaceId}
        taken={aliases.map((a) => a.name)}
        busy={busy}
        run={run}
      />
    </div>
  );
}
