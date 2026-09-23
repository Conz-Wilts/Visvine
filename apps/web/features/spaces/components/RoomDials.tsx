'use client';

// The four dials of a room (docs/sub-spaces.md, lib/spaces/subspaces.ts):
// who can see it, who may walk in, what flows up into the house, and who
// holds its keys. Every dial is the room's own to set — the house cannot set
// any of them — so they live on the room's Settings and nowhere on the
// parent's. Each change saves itself through the console's action pill and
// undoes itself when the server refuses (a world listing whose name is taken,
// governance a non-holder tries to hand back on).

import { useState } from 'react';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { Alert, ConfirmDialog } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import type { Space } from '@/lib/types';
import {
  DOORS,
  LISTINGS,
  asDoor,
  doorsOf,
  listingOf,
  type Door,
  type Listing,
} from '@/lib/spaces/subspaces';
import { EyeOffIcon, GlobeIcon, HouseIcon } from '@/features/shared/icons';

type Patch = Record<string, unknown>;

interface Props {
  space: Space;
  parentName: string;
  /** Saves one patch; rejects with the server's message on refusal. */
  save: (patch: Patch) => Promise<unknown>;
}

const LISTING_COPY: Record<Listing, { label: string; blurb: (parent: string) => string; icon: React.ReactNode }> = {
  secret: { label: 'Secret', blurb: () => 'Only members and invite holders know it exists. Not on the band, not on Discover.', icon: <EyeOffIcon className="h-4 w-4" /> },
  house: { label: 'This house', blurb: (p) => `Members of ${p} see its door — name, blurb, member count. Not on Discover.`, icon: <HouseIcon className="h-4 w-4" /> },
  world: { label: 'Everyone', blurb: (p) => `On Discover for anyone, and on ${p}'s band.`, icon: <GlobeIcon className="h-4 w-4" /> },
};

const DOOR_COPY: Record<Door, string> = {
  invite: 'Invite only',
  ask: 'Ask — an admin here answers',
  open: 'Walk in',
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function RoomDials({ space, parentName, save }: Props) {
  const [listing, setListing] = useState<Listing>(listingOf({ visibility: space.visibility ?? null, parentId: space.parentId ?? null, listing: space.listing }));
  const [houseDoor, setHouseDoor] = useState<Door>(asDoor(space.houseDoor, 'ask'));
  const [worldDoor, setWorldDoor] = useState<Door>(asDoor(space.worldDoor, 'open'));
  const [flowContext, setFlowContext] = useState(space.flowContext !== false);
  const [flowEvents, setFlowEvents] = useState(space.flowEvents !== false);
  const [parentAdmins, setParentAdmins] = useState(Boolean(space.parentAdmins));
  const { administersDirectly } = useSpace();
  // Only a holder of the room's OWN admin alias may hand governance back on;
  // a house admin standing here through that very switch cannot.
  const canRestoreGovernance = parentAdmins || administersDirectly(space.id);
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [confirmWorld, setConfirmWorld] = useState(false);

  const dials = { visibility: space.visibility ?? null, parentId: space.parentId ?? null, listing, houseDoor, worldDoor };
  const effective = doorsOf(dials);
  const secret = listing === 'secret';
  const world = listing === 'world';
  const clamped = world && effective.world !== worldDoor;

  // ── Listing ───────────────────────────────────────────────────────────────
  const applyListing = async (next: Listing) => {
    const previous = listing;
    setError('');
    setNotice('');
    setListing(next);
    try {
      await save({ listing: next });
      if (previous === 'secret' && next !== 'secret') {
        setNotice(`Now listed. What flows up is back to the switches below — context ${flowContext ? 'on' : 'off'}, events ${flowEvents ? 'on' : 'off'}.`);
      } else if (previous === 'world' && next === 'secret') {
        setNotice('Off Discover and off the band on the next read. Members stay; pending asks are kept for admins here to answer.');
      } else if (previous === 'world') {
        setNotice('Off Discover on the next read. Members stay.');
      }
    } catch (err) {
      setListing(previous);
      setError(errorText(err, 'Could not change the listing'));
    }
  };
  const chooseListing = (next: Listing) => {
    if (next === listing) return;
    // Listing to the world is what puts the room on Discover and requires a
    // free public name, so it asks first, like the top-level toggle does.
    if (next === 'world') setConfirmWorld(true);
    else void applyListing(next);
  };

  // ── Doors ─────────────────────────────────────────────────────────────────
  const applyDoor = async (which: 'houseDoor' | 'worldDoor', next: Door) => {
    const set = which === 'houseDoor' ? setHouseDoor : setWorldDoor;
    const previous = which === 'houseDoor' ? houseDoor : worldDoor;
    setError('');
    set(next);
    try {
      await save({ [which]: next });
    } catch (err) {
      set(previous);
      setError(errorText(err, 'Could not change the door'));
    }
  };

  // ── Flows ─────────────────────────────────────────────────────────────────
  const applyFlow = async (key: 'flowContext' | 'flowEvents', next: boolean) => {
    const set = key === 'flowContext' ? setFlowContext : setFlowEvents;
    setError('');
    set(next);
    try {
      await save({ [key]: next });
    } catch (err) {
      set(!next);
      setError(errorText(err, 'Could not change what flows up'));
    }
  };

  // ── Governance ────────────────────────────────────────────────────────────
  // Any admin of the room may hand the keys back; only a holder of the room's
  // own admin alias may hand them out again (`administersDirectly`). The
  // server decides too, so a refusal is still shown in place.
  const applyGovernance = async (next: boolean) => {
    setError('');
    setParentAdmins(next);
    try {
      await save({ parentAdmins: next });
    } catch (err) {
      setParentAdmins(!next);
      setError(errorText(err, 'Could not change who manages this space'));
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-fg">This room in {parentName}</h2>
        <p className="mt-0.5 text-sm text-fg-muted">
          Four things this space decides about the house it sits in. Membership never crosses: joining here does not join {parentName}, and joining {parentName} does not join here.
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {notice && !error && <Alert variant="info">{notice}</Alert>}

      {/* Listing */}
      <DialBlock title="Who can see it" hint="Its name, blurb and member count — and where it is listed.">
        <div role="radiogroup" aria-label="Listing" className="grid gap-2 sm:grid-cols-3">
          {LISTINGS.map((l) => {
            const active = l === listing;
            const copy = LISTING_COPY[l];
            return (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => chooseListing(l)}
                className={`flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-accent bg-accent/10 text-fg'
                    : 'border-line-subtle bg-surface text-fg-secondary hover:border-line'
                }`}
              >
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <span className={active ? 'text-accent-strong' : 'text-fg-muted'}>{copy.icon}</span>
                  {copy.label}
                </span>
                <span className="text-xs text-fg-muted">{copy.blurb(parentName)}</span>
              </button>
            );
          })}
        </div>
      </DialBlock>

      {/* Doors */}
      <DialBlock title="Who may walk in" hint={secret ? 'A secret room has no doors — entry is by invite only.' : 'Without an invite. The world’s door is never wider than the house’s.'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <DoorPicker
            id="house-door"
            label={`Members of ${parentName}`}
            value={houseDoor}
            disabled={secret}
            onChange={(d) => void applyDoor('houseDoor', d)}
          />
          <DoorPicker
            id="world-door"
            label="Everyone else"
            value={worldDoor}
            disabled={secret || !world}
            onChange={(d) => void applyDoor('worldDoor', d)}
            note={
              !world
                ? 'Only a room listed to everyone has a door for the world.'
                : clamped
                  ? `Clamped to “${DOOR_COPY[effective.world].toLowerCase()}” — the house’s door is ${DOOR_COPY[houseDoor].toLowerCase()}.`
                  : undefined
            }
          />
        </div>
      </DialBlock>

      {/* Flows */}
      <DialBlock
        title={`What ${parentName} can read`}
        hint={secret ? 'Nothing flows from a secret room: a folder or an event carrying its name would reveal it.' : 'Read-only, as of now. Whatever this room shows all of its members, and no more.'}
      >
        <div className="divide-y divide-line-subtle rounded-lg border border-line-subtle">
          <FlowRow
            title="Context"
            blurb={`This room's notes appear in ${parentName}'s tree as one read-only folder, under this room's name.`}
            checked={flowContext && !secret}
            disabled={secret}
            onChange={(v) => void applyFlow('flowContext', v)}
          />
          <FlowRow
            title="Events"
            blurb={`This room's public events appear on ${parentName}'s calendar, badged with this room.`}
            checked={flowEvents && !secret}
            disabled={secret}
            onChange={(v) => void applyFlow('flowEvents', v)}
          />
        </div>
      </DialBlock>

      {/* Governance */}
      <DialBlock title="Who holds the keys" hint="This room's own admins always do.">
        <div className="flex items-start justify-between gap-4 rounded-lg border border-line-subtle px-4 py-3">
          <div>
            <p className="text-sm font-medium text-fg">Managed by {parentName}&apos;s admins too</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {parentAdmins
                ? `Whoever administers ${parentName} administers this room — settings, members, connectors. Switching this off makes the room autonomous; only an admin of this space itself can switch it back on.`
                : canRestoreGovernance
                  ? `Autonomous: only the holders of this space's own admin alias manage it. ${parentName} cannot take this back.`
                  : `Autonomous. Only an admin of this space itself can turn this back on — your standing here comes through ${parentName}.`}
            </p>
          </div>
          <Toggle checked={parentAdmins} disabled={!canRestoreGovernance} onChange={(v) => void applyGovernance(v)} aria-label={`Managed by ${parentName}'s admins too`} />
        </div>
      </DialBlock>

      <ConfirmDialog
        open={confirmWorld}
        title="List this room to everyone?"
        body={<>Anyone will find <span className="font-semibold">{space.name}</span> in Discover.</>}
        confirmLabel="List to everyone"
        onConfirm={() => {
          setConfirmWorld(false);
          void applyListing('world');
        }}
        onClose={() => setConfirmWorld(false)}
      />
    </section>
  );
}

function DialBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function DoorPicker({
  id,
  label,
  value,
  disabled,
  onChange,
  note,
}: {
  id: string;
  label: string;
  value: Door;
  disabled?: boolean;
  onChange: (door: Door) => void;
  note?: string;
}) {
  return (
    <div className={`rounded-lg border border-line-subtle px-4 py-3 ${disabled ? 'opacity-60' : ''}`}>
      <p className="text-sm font-medium text-fg">{label}</p>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="mt-2 flex flex-wrap gap-1.5">
        <span id={`${id}-label`} className="sr-only">{label}</span>
        {DOORS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={value === d}
            disabled={disabled}
            onClick={() => onChange(d)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
              value === d
                ? 'border-accent bg-accent/10 text-fg'
                : 'border-line-subtle bg-surface text-fg-secondary hover:border-line'
            }`}
          >
            {DOOR_COPY[d]}
          </button>
        ))}
      </div>
      {note && <p className="mt-2 text-xs text-fg-muted">{note}</p>}
    </div>
  );
}

function FlowRow({
  title,
  blurb,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  blurb: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className={`flex items-start justify-between gap-4 px-4 py-3 ${disabled ? 'opacity-60' : ''}`}>
      <div>
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs text-fg-muted">{blurb}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} aria-label={`${title} flows up`} />
    </div>
  );
}
