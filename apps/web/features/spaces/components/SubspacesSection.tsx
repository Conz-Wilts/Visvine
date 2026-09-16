'use client';

// The Sub-spaces section of a space's console (docs/sub-spaces.md): the
// rooms of this house, and the house's side of the wall. A room is its own
// tenant from the moment it exists (own members, own admins, own tools) and
// its four dials are its own to set, so a row here is a listing plus the one
// thing the HOUSE decides: whether its model keys reach the room. Creating a
// room is the one act only this space's admins can perform, and it starts
// from a preset — the structures people build, as dial settings.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Modal } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { ensureRootIndexNote } from '@/features/notes/lib/rootIndex';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { PlusIcon } from '@/features/shared/icons';
import { PRESETS, subspaceConfigOf, type SubspaceConfig } from '@/lib/spaces/subspaces';
import type { Space } from '@/lib/types';

export interface SubspaceDto {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  visibility: 'public' | 'private';
  listing: 'secret' | 'house' | 'world';
  houseDoor: 'invite' | 'ask' | 'open';
  worldDoor: 'invite' | 'ask' | 'open';
  flowContext: boolean;
  flowEvents: boolean;
  flowPeople: boolean;
  parentAdmins: boolean;
  memberCount: number;
  upcomingEvents: number;
  viewerStatus: 'admin' | 'member' | 'pending' | 'none';
}

const DOOR_WORD: Record<SubspaceDto['houseDoor'], string> = { invite: 'need an invite', ask: 'ask', open: 'walk in' };

function listingWord(sub: SubspaceDto): string {
  if (sub.listing === 'world') return 'Listed to everyone';
  if (sub.listing === 'house') return 'Listed here';
  return 'Secret';
}

function flowsWord(sub: SubspaceDto): string {
  if (sub.listing === 'secret') return 'nothing flows up';
  const on = [sub.flowContext && 'context', sub.flowEvents && 'events', sub.flowPeople && 'people'].filter(Boolean);
  return on.length ? `${on.join(', ')} flow up` : 'nothing flows up';
}

export default function SubspacesSection({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const { joinedSpaces, spaces, refreshSpace, setCurrentSpace } = useSpace();
  const [rows, setRows] = useState<SubspaceDto[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  // The house's side, read off the space row the client already holds and
  // written back whole: the settings route replaces the JSON column.
  const house = spaces.find((s) => s.id === spaceId) as Space | undefined;
  const [config, setConfig] = useState<SubspaceConfig>(() => subspaceConfigOf(house?.subspaceConfig));
  useEffect(() => { setConfig(subspaceConfigOf(house?.subspaceConfig)); }, [house?.subspaceConfig]);

  const saveConfig = async (next: SubspaceConfig) => {
    const previous = config;
    setConfig(next);
    setConfigError(null);
    try {
      await fetchJsonBody(`/api/spaces/${encodeURIComponent(spaceId)}/settings`, 'PUT', { subspaceConfig: next });
      await refreshSpace();
    } catch (err) {
      setConfig(previous);
      setConfigError(err instanceof Error ? err.message : 'Could not save');
    }
  };
  const modelKeysMode: 'none' | 'all' | 'some' = config.modelKeys === 'all' ? 'all' : config.modelKeys.length ? 'some' : 'none';
  const setModelKeysMode = (mode: 'none' | 'all' | 'some') => {
    if (mode === 'all') void saveConfig({ ...config, modelKeys: 'all' });
    else if (mode === 'none') void saveConfig({ ...config, modelKeys: [] });
    else void saveConfig({ ...config, modelKeys: config.modelKeys === 'all' ? (rows ?? []).map((r) => r.id) : config.modelKeys });
  };
  const toggleModelKeyRoom = (roomId: string, on: boolean) => {
    const list = config.modelKeys === 'all' ? (rows ?? []).map((r) => r.id) : config.modelKeys;
    const set = new Set(list);
    if (on) set.add(roomId); else set.delete(roomId);
    void saveConfig({ ...config, modelKeys: [...set] });
  };
  const roomIds = useMemo(() => new Set((rows ?? []).map((r) => r.id)), [rows]);

  // Through the shared request cache: a return to General paints the last
  // list at once. A write here drops the key first, so it reads fresh.
  const key = `spaces:subspaces:${spaceId}`;
  const load = useCallback(async (fresh = false) => {
    if (fresh) invalidateRequestCache(key);
    try {
      await swrFetch(
        key,
        () => fetchJson<{ subspaces: SubspaceDto[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/subspaces`),
        (data) => setRows(data.subspaces),
      );
    } catch {
      setRows([]);
    }
  }, [key, spaceId]);

  useEffect(() => { void load(); }, [load]);

  const joined = (id: string) => joinedSpaces.some((s) => s.id === id);

  return (
    <section>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Sub-spaces</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Rooms of this house, each its own space with its own members, admins and tools. What a room shows
            here, who may walk in and who holds its keys are set in the room&rsquo;s own Settings. Here: what this
            house shares down.
          </p>
        </div>
        <Button variant="neutral" size="sm" className="inline-flex shrink-0 items-center gap-1.5" onClick={() => setCreating(true)}>
          <PlusIcon size={16} aria-hidden />
          New sub-space
        </Button>
      </div>

      {rows === null ? null : rows.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">No sub-spaces yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border-subtle">
          {rows.map((sub) => (
            <li key={sub.id} className="flex flex-wrap items-center gap-3 py-3">
              <SpaceAvatar name={sub.name} imageUrl={sub.imageUrl} size="sm" />
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate text-[15px] font-semibold text-text-primary">{sub.name}</div>
                <p className="truncate text-[13px] text-text-muted">
                  {listingWord(sub)}
                  {sub.listing !== 'secret' && ` · members here ${DOOR_WORD[sub.houseDoor]}`}
                  {sub.listing === 'world' && ` · everyone else ${DOOR_WORD[sub.worldDoor]}`}
                  {' · '}{flowsWord(sub)}
                  {' · '}{sub.parentAdmins ? 'managed here too' : 'autonomous'}
                </p>
                <p className="truncate text-[13px] text-text-muted">
                  {sub.memberCount} {sub.memberCount === 1 ? 'member' : 'members'}
                  {sub.upcomingEvents > 0 && ` · ${sub.upcomingEvents} upcoming ${sub.upcomingEvents === 1 ? 'event' : 'events'}`}
                </p>
              </div>
              {joined(sub.id) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCurrentSpace(sub.id, '/directory');
                  }}
                >
                  Open
                </Button>
              ) : (
                <span className="text-xs text-text-muted">Not a member</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="mt-5 rounded-lg border border-border-subtle px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Model keys</p>
              <p className="mt-0.5 text-xs text-text-muted">
                Let rooms&rsquo; agents run on this space&rsquo;s model keys, so they need none of their own. This space pays.
              </p>
            </div>
            <div role="radiogroup" aria-label="Share model keys with" className="flex flex-wrap gap-1.5">
              {([['none', 'No rooms'], ['all', 'All rooms'], ['some', 'Chosen rooms']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={modelKeysMode === mode}
                  onClick={() => setModelKeysMode(mode)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    modelKeysMode === mode
                      ? 'border-brand-green bg-brand-green/10 text-text-primary'
                      : 'border-border-subtle bg-surface-1 text-text-secondary hover:border-border-default'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {modelKeysMode === 'some' && (
            <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
              {rows.map((sub) => (
                <li key={sub.id}>
                  <Toggle
                    checked={config.modelKeys !== 'all' && config.modelKeys.includes(sub.id) && roomIds.has(sub.id)}
                    onChange={(on) => toggleModelKeyRoom(sub.id, on)}
                    label={<span className="text-xs text-text-secondary">{sub.name}</span>}
                    aria-label={`Share model keys with ${sub.name}`}
                  />
                </li>
              ))}
            </ul>
          )}
          {configError && <Alert variant="error" className="mt-3">{configError}</Alert>}
        </div>
      )}

      {creating && (
        <NewSubspaceDialog
          parentId={spaceId}
          parentName={spaceName}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await Promise.all([refreshSpace(), load(true)]);
          }}
        />
      )}
    </section>
  );
}

function NewSubspaceDialog({
  parentId,
  parentName,
  onClose,
  onCreated,
}: {
  parentId: string;
  parentName: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState<string>('department');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim().length > 0;

  const submit = async () => {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { space } = await fetchJsonBody<{ space: { id: string; name: string } }>('/api/spaces', 'POST', {
        name: name.trim(),
        parentId,
        preset,
      });
      // The context has to exist before anyone opens it — the same wait the
      // top-level create makes (NewSpaceDialog).
      await ensureRootIndexNote(space.id, space.name);
      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sub-space');
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`New sub-space of ${parentName}`}
      size="sm"
      footer={
        <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="brand" onClick={submit} disabled={!ready} loading={saving} loadingText="Creating…">
            Create
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <Input
          autoFocus
          aria-label="Sub-space name"
          placeholder="Sub-space name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        {/* The structures people build, as dial settings. A preset only decides
            where the room's dials start; each one stays editable in the room's
            own Settings afterwards. */}
        <div role="radiogroup" aria-label="Room preset" className="grid gap-2">
          {PRESETS.map((p) => {
            const active = p.key === preset;
            return (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPreset(p.key)}
                className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? 'border-brand-green bg-brand-green/10 text-text-primary'
                    : 'border-border-subtle bg-surface-1 text-text-secondary hover:border-border-default'
                }`}
              >
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-xs text-text-muted">{p.blurb}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-muted">
          You become its admin{preset === 'tenant' ? '' : `, and so are ${parentName}'s admins until the room says otherwise`}. It starts with every optional tool off and its own member list.
        </p>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
