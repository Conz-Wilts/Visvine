'use client';

import { useState } from 'react';
import { Avatar, Toggle } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSubscriber } from '@/lib/agents/service';
import { missingInputs, type AgentInput, type InputValues } from '@/lib/agents/shared/inputs';

/**
 * Who the agent runs for, inside its Share dialog: sharing an agent decides
 * who may read it, and a person who can read it may have it run for them. One
 * row per person the agent runs for (its record); your own row is the switch, and
 * — on — your own time, model and inputs. The agent's own identity keeps its
 * inputs on the record (`input_values`), edited here by whoever it runs as.
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
  inputs,
  ownValues,
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
  /** What each person supplies for themselves (lib/agents/shared/inputs.ts). */
  inputs: AgentInput[];
  /** The agent's own identity's values — the viewer's, when they are its author. */
  ownValues: InputValues;
  onChanged: () => void;
}) {
  const mine = people.find((p) => p.userId === viewerId) ?? null;
  const others = people.filter((p) => p.userId !== viewerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const base = `/api/spaces/${spaceId}/agents/${encodeURIComponent(agentName)}`;
  const url = `${base}/subscribers`;

  const send = async (method: 'POST' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetchJson<{ warning?: string | null }>(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      setWarning(method === 'POST' ? (r?.warning ?? null) : null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  const save = (patch: { at?: string | null; model?: string | null; inputs?: InputValues }) =>
    send('POST', {
      at: (patch.at !== undefined ? patch.at : mine?.at) || null,
      model: (patch.model !== undefined ? patch.model : mine?.model) || null,
      inputs: patch.inputs ?? mine?.inputs ?? {},
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  const saveOwn = async (values: InputValues) => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input_values: values }) });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (viewerIsAuthor && others.length === 0 && inputs.length === 0) return null;
  const field = 'h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-fg disabled:opacity-40';

  return (
    <section>
      <h4 className="mb-1 text-sm font-semibold text-fg">Runs for</h4>
      {error && <p className="pb-1 text-[12px] text-danger">{error}</p>}
      {!error && warning && <p className="pb-1 text-[12px] text-warning">{warning}</p>}
      <ul className="-mx-2 flex flex-col">
        {viewerIsAuthor && inputs.length > 0 && (
          <li className="flex flex-col gap-2 rounded-xl px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={viewerName} imageUrl={viewerImage} size="sm" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">You</span>
            </div>
            <InputFields inputs={inputs} values={ownValues} busy={busy} className={field} onSave={saveOwn} />
          </li>
        )}
        {!viewerIsAuthor && (
          <li className="flex flex-col gap-2 rounded-xl px-2 py-1.5">
            <div className="flex items-center gap-2.5">
              <Avatar name={viewerName} imageUrl={viewerImage} size="sm" className="shrink-0" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">You</span>
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
            {mine && <InputFields inputs={inputs} values={mine.inputs} busy={busy} className={field} onSave={(values) => save({ inputs: values })} />}
          </li>
        )}
        {others.map((person) => (
          <li key={person.userId} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-surface-subtle">
            <Avatar name={person.name ?? 'A member'} imageUrl={person.image} size="sm" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-fg">{person.name ?? 'A member'}</div>
              {(person.at || person.model || missingInputs(inputs, person.inputs).length > 0) && (
                <div className="truncate text-[11px] text-fg-muted">
                  {[person.at, person.model, missingInputs(inputs, person.inputs).length > 0 ? 'waiting' : null].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            {canManage && (
              <button
                type="button"
                className="shrink-0 rounded-lg px-2 py-1 text-[12px] text-fg-muted hover:bg-surface-muted hover:text-danger disabled:opacity-40"
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

/** One field per declared input, saved as each is left. */
function InputFields({
  inputs,
  values,
  busy,
  className,
  onSave,
}: {
  inputs: AgentInput[];
  values: InputValues;
  busy: boolean;
  className: string;
  onSave: (values: InputValues) => void;
}) {
  if (inputs.length === 0) return null;
  const set = (key: string, value: string) => {
    if ((values[key] ?? '') === value) return;
    const next = { ...values };
    if (value) next[key] = value;
    else delete next[key];
    onSave(next);
  };
  return (
    <div className="flex flex-col gap-1.5 pl-[42px]">
      {inputs.map((input) =>
        input.kind === 'select' ? (
          <select
            key={input.key}
            aria-label={input.label}
            className={`${className} min-w-0`}
            disabled={busy}
            value={values[input.key] ?? ''}
            onChange={(e) => set(input.key, e.target.value)}
          >
            <option value="">{input.label}</option>
            {input.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            key={input.key}
            type="text"
            aria-label={input.label}
            placeholder={input.label}
            className={`${className} min-w-0`}
            disabled={busy}
            defaultValue={values[input.key] ?? ''}
            onBlur={(e) => set(input.key, e.target.value.trim())}
          />
        ),
      )}
    </div>
  );
}
