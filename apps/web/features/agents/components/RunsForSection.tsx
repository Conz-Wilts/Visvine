'use client';

import { useState } from 'react';
import { Avatar } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSubscriber } from '@/lib/agents/service';

/**
 * Who the agent runs for, inside its Share dialog: sharing an agent decides
 * who may read it, and a person who can read it may have it run for them. One
 * row per person in the brief's `for:` block; your own row is the switch, and
 * — on — your own time and model.
 */
export default function RunsForSection({
  spaceId,
  agentName,
  people,
  viewerId,
  viewerName,
  viewerImage,
  viewerIsAuthor,
  canManage,
  models,
  daily,
  onChanged,
}: {
  spaceId: string;
  agentName: string;
  people: AgentSubscriber[];
  viewerId: string;
  viewerName: string;
  viewerImage: string | null;
  /** The agent's own runs already are the viewer's. */
  viewerIsAuthor: boolean;
  canManage: boolean;
  /** Model refs a person may pick: the space's, then their own plans. */
  models: { ref: string; label: string }[];
  /** A daily or weekly agent — the only clock a time of your own means anything on. */
  daily: boolean;
  onChanged: () => void;
}) {
  const mine = people.find((p) => p.userId === viewerId) ?? null;
  const others = people.filter((p) => p.userId !== viewerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/spaces/${spaceId}/agents/${encodeURIComponent(agentName)}/subscribers`;

  const send = async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: { at?: string | null; model?: string | null }) =>
    send('POST', {
      at: (patch.at !== undefined ? patch.at : mine?.at) || null,
      model: (patch.model !== undefined ? patch.model : mine?.model) || null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

  if (viewerIsAuthor && others.length === 0) return null;
  const field = 'h-8 rounded-lg border border-border-default bg-surface-1 px-2 text-[13px] text-text-primary disabled:opacity-40';

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold text-text-primary">Runs for</h4>
      {error && <p className="pb-1 text-[12px] text-red-600">{error}</p>}
      <ul className="-mx-2 flex flex-col">
        {!viewerIsAuthor && (
          <li className="flex flex-col gap-2 rounded-xl px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={viewerName} imageUrl={viewerImage} size="sm" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">You</span>
              <Toggle
                checked={!!mine}
                disabled={busy}
                aria-label="Runs for you"
                onChange={(on) => (on ? save({}) : send('DELETE', {}))}
                className="mr-1 shrink-0"
              />
            </div>
            {mine && (
              <div className="flex items-center gap-2 pl-[42px]">
                {daily && (
                  <input
                    type="time"
                    aria-label="Time"
                    className={field}
                    disabled={busy}
                    defaultValue={mine.at ?? ''}
                    onBlur={(e) => e.target.value !== (mine.at ?? '') && save({ at: e.target.value })}
                  />
                )}
                <select
                  aria-label="Model"
                  className={`${field} min-w-0 flex-1`}
                  disabled={busy}
                  value={mine.model ?? ''}
                  onChange={(e) => save({ model: e.target.value })}
                >
                  <option value="">Agent’s model</option>
                  {models.map((m) => (
                    <option key={m.ref} value={m.ref}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </li>
        )}
        {others.map((person) => (
          <li key={person.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-2">
            <Avatar name={person.name ?? 'A member'} imageUrl={person.image} size="sm" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-text-primary">{person.name ?? 'A member'}</div>
              {(person.at || person.model) && (
                <div className="truncate text-[11px] text-text-muted">{[person.at, person.model].filter(Boolean).join(' · ')}</div>
              )}
            </div>
            {canManage && (
              <button
                type="button"
                className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-text-muted hover:bg-surface-3 hover:text-red-600 disabled:opacity-40"
                disabled={busy}
                onClick={() => send('DELETE', { userId: person.userId })}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
