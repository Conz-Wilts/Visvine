'use client';

// The Sub-spaces section of a space's console (docs/sub-spaces.md): the
// rooms of this house, and the house's side of the wall. A room is its own
// tenant from the moment it exists (own members, own admins, own tools) and
// its four dials are its own to set, so a row here is a listing plus the one
// thing the HOUSE decides: whether its model keys reach the room. Rooms are
// made from the space switcher, not here; with none, the section is not drawn.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import SpaceAvatar from '@/features/spaces/components/SpaceAvatar';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { invalidateRequestCache, swrFetch } from '@/features/shared/lib/requestCache';
import { subspaceConfigOf, type SubspaceConfig } from '@/lib/spaces/subspaces';
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
  const on = [sub.flowContext && 'context', sub.flowEvents && 'events'].filter(Boolean);
  return on.length ? `${on.join(', ')} flow up` : 'nothing flows up';
}

export default function SubspacesSection({ spaceId }: { spaceId: string }) {
  const { joinedSpaces, spaces, refreshSpace, setCurrentSpace } = useSpace();
  const [rows, setRows] = useState<SubspaceDto[] | null>(null);
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

  if (rows === null || rows.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-semibold text-text-primary">Sub-spaces</h2>
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
    </section>
  );
}
