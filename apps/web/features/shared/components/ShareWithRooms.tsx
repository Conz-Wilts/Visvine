'use client';

// Who a house's connector, agent or Tool reaches (docs/sub-spaces.md): none of
// its rooms, all of them, or the ones ticked. One control for the three
// kinds, because the note key it writes is the same `share:` on each — and so
// a house admin learns it once.
//
// `warnFor` lets the caller add a line under a room that deserves a second
// look before saving (a space-account connector into a room strangers can
// join). It is a warning, not a refusal: the save still happens on Confirm.

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { TriangleAlertIcon } from '@/features/shared/icons';
import { swrFetch } from '@/features/shared/lib/requestCache';
import { fetchJson } from '@/lib/fetchJson';
import type { SubspaceDto } from '@/features/spaces/components/SubspacesSection';

export type ShareValue = 'none' | 'all' | string[];

export default function ShareWithRooms({
  spaceId,
  value,
  saving,
  onSave,
  what,
  warnFor,
}: {
  /** The house — whose sub-spaces are offered. */
  spaceId: string;
  value: ShareValue;
  saving: boolean;
  onSave: (next: ShareValue) => Promise<boolean>;
  /** The noun in the copy: "connector", "agent", "tool". */
  what: string;
  /** A caution for one room, or null. Shown under the room and gathered above Save. */
  warnFor?: (room: SubspaceDto) => string | null;
}) {
  const [rooms, setRooms] = useState<SubspaceDto[] | null>(null);
  const [mode, setMode] = useState<'none' | 'all' | 'some'>(value === 'all' ? 'all' : value === 'none' ? 'none' : 'some');
  const [picked, setPicked] = useState<Set<string>>(new Set(Array.isArray(value) ? value : []));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(value === 'all' ? 'all' : value === 'none' ? 'none' : 'some');
    setPicked(new Set(Array.isArray(value) ? value : []));
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    void swrFetch<{ subspaces: SubspaceDto[] }>(
      `spaces:subspaces:${spaceId}`,
      () => fetchJson<{ subspaces: SubspaceDto[] }>(`/api/spaces/${encodeURIComponent(spaceId)}/subspaces`),
      (data) => { if (!cancelled) setRooms(data.subspaces ?? []); },
    ).catch(() => { if (!cancelled) setRooms([]); });
    return () => { cancelled = true; };
  }, [spaceId]);

  const next: ShareValue = mode === 'all' ? 'all' : mode === 'none' ? 'none' : [...picked];
  const dirty = JSON.stringify(next) !== JSON.stringify(Array.isArray(value) ? [...value] : value);

  const reached = useMemo(() => {
    if (!rooms) return [];
    if (mode === 'all') return rooms;
    if (mode === 'none') return [];
    return rooms.filter((r) => picked.has(r.id));
  }, [rooms, mode, picked]);
  const warnings = useMemo(
    () => (warnFor ? reached.map((r) => ({ room: r, text: warnFor(r) })).filter((w) => w.text) : []),
    [reached, warnFor],
  );

  const save = async () => {
    setError(null);
    const ok = await onSave(next);
    if (!ok) setError(`Could not save who this ${what} is shared with.`);
  };

  const radio = (m: 'none' | 'all' | 'some', label: string, hint: string) => (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="radio" name={`share-${what}`} className="mt-1" checked={mode === m} onChange={() => setMode(m)} disabled={saving} />
      <span>
        <span className="font-medium text-text-primary">{label}</span>
        <span className="block text-xs text-text-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="rounded-lg border border-border-subtle px-3 py-3">
      <p className="text-sm font-medium text-text-primary">Share with sub-spaces</p>
      <p className="mb-3 text-xs text-text-muted">
        A room this {what} reaches uses it as its own, with this space&apos;s keys and accounts; nothing in the room can change it.
      </p>
      <div className="grid gap-2">
        {radio('none', 'No rooms', `Only this space's agents and tools can use it.`)}
        {radio('all', 'Every room', 'Every sub-space now, and any created later.')}
        {radio('some', 'Only these rooms', 'Pick which sub-spaces.')}
      </div>
      {mode === 'some' && (
        <ul className="mt-2 grid gap-1 pl-6">
          {rooms === null && <li className="text-xs text-text-muted">Loading rooms…</li>}
          {rooms?.length === 0 && <li className="text-xs text-text-muted">This space has no sub-spaces yet.</li>}
          {rooms?.map((room) => (
            <li key={room.id}>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={picked.has(room.id)}
                  disabled={saving}
                  onChange={(e) => {
                    const copy = new Set(picked);
                    if (e.target.checked) copy.add(room.id);
                    else copy.delete(room.id);
                    setPicked(copy);
                  }}
                />
                <span className="text-text-primary">{room.name}</span>
                <span className="text-xs text-text-muted">
                  {room.listing === 'world' ? 'listed to everyone' : room.listing === 'house' ? 'listed here' : 'secret'}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <ul className="mt-3 grid gap-1">
          {warnings.map((w) => (
            <li key={w.room.id} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
              <span><span className="font-medium">{w.room.name}:</span> {w.text}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex justify-end">
        <Button size="sm" variant={warnings.length ? 'danger-text' : 'brand'} disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : warnings.length ? 'Share anyway' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
