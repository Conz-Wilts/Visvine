'use client';

import { useEffect, useRef, useState } from 'react';
import { Chip, Input, Select } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { LOCAL_RUNTIMES, localModelRef } from '@/lib/agents/local';
import { briefTags, withBriefTags } from '@/lib/agents/briefEdit';
import type { AgentConfigInput } from '@/lib/agents/configInput';
import type { AgentConfig as AgentRecordConfig } from '@/lib/agents/shared/agentConfig';
import type { AgentSummary } from '@/lib/agents/service';
import { useAgentOptions } from '../lib/useAgentOptions';
import MachinePane from './MachinePane';

const ON = 'var(--vv-color-accent)';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center gap-4 border-b border-line-subtle py-2">
      <span className="w-28 shrink-0 text-[13px] text-fg-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * What the agent runs on and reaches, one row each: when, model, tools,
 * connectors, group, cap. Each is saved as it is changed — there is no Save.
 * Model, tools and connectors are the agent's RECORD (`PUT …/config`, gated
 * per field on the server); Group is the brief's `tags:`, written to the note
 * through the ordinary notes API; the cap is the budget route's. Anything a
 * row does not cover is the note itself, on the Context tab.
 */
export default function AgentConfig({
  spaceId,
  agent,
  isAdmin,
  canManage,
  liveRun,
  onSchedule,
  onSaved,
}: {
  spaceId: string;
  agent: AgentSummary & { brief: string; config: AgentRecordConfig };
  isAdmin: boolean;
  canManage: boolean;
  liveRun: boolean;
  onSchedule: () => void;
  onSaved: () => void;
}) {
  const { options } = useAgentOptions(spaceId);
  const [value, setValue] = useState<AgentRecordConfig>(agent.config);
  const [tags, setTags] = useState<string[]>(() => briefTags(agent.brief));
  const [group, setGroup] = useState(tags.join(', '));
  const [cap, setCap] = useState(agent.spend?.budgetMonthlyCents != null ? (agent.spend.budgetMonthlyCents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  // Saves are chained so two quick presses write in the order they were made.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // A save elsewhere (the note, an action) shows up on reload.
  useEffect(() => setValue(agent.config), [agent.config]);
  useEffect(() => {
    const next = briefTags(agent.brief);
    setTags(next);
    setGroup(next.join(', '));
  }, [agent.brief]);

  const enqueue = (write: () => Promise<void>, undo: () => void) => {
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await write();
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save');
        undo();
      }
    });
  };

  const save = (patch: Partial<AgentRecordConfig>, input: AgentConfigInput) => {
    setValue((v) => ({ ...v, ...patch }));
    enqueue(
      () =>
        fetchJson(`/api/spaces/${spaceId}/agents/${encodeURIComponent(agent.name)}/config`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }).then(() => undefined),
      () => setValue(agent.config),
    );
  };

  const saveTags = (next: string[]) => {
    setTags(next);
    enqueue(
      async () => {
        const { content } = await notesApi.read(spaceId, agent.path);
        await notesApi.write(spaceId, agent.path, withBriefTags(content, next));
      },
      () => setTags(briefTags(agent.brief)),
    );
  };

  const saveCap = async () => {
    const dollars = cap.trim() === '' ? null : Number(cap);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) return setError('The cap is a dollar amount, or empty for none.');
    setError(null);
    try {
      await fetchJson(`/api/spaces/${spaceId}/agents/${encodeURIComponent(agent.name)}/budget`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: dollars === null ? null : Math.round(dollars * 100) }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the cap');
    }
  };

  const models = options?.models ?? [];
  const pinned = value.model?.trim() ?? '';
  const known = !pinned || pinned.startsWith('local/') || models.some((m) => m.ref === pinned);
  const connectors = options?.connectors ?? [];
  const when = agent.activation.active
    ? [agent.activation.scheduleLabel.replace(/^No schedule$/, ''), agent.activation.triggersLabel].filter(Boolean).join(' · ') || 'On'
    : 'Off';
  const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

  return (
    <div className="flex flex-col gap-8">
      <fieldset disabled={!canManage} className="flex flex-col">
        {error && <p className="pb-2 text-[13px] text-danger">{error}</p>}
        <Row label="When">
          <button type="button" className="text-left text-[13.5px] text-fg hover:underline disabled:no-underline" onClick={onSchedule}>
            {when}
          </button>
        </Row>
        <Row label="Model">
          <div className="max-w-xs">
          <Select value={pinned} aria-label="Model" onChange={(e) => save({ model: e.target.value || null }, { model: e.target.value || null })}>
            <option value="">{options?.spaceModel ? `Space’s model · ${options.spaceModel.label}` : 'Space’s model'}</option>
            {models.map((m) => (
              <option key={m.name} value={m.ref ?? ''} disabled={!m.ref || m.problem !== null}>
                {m.providerLabel} · {m.label}
              </option>
            ))}
            {!known && <option value={pinned}>{pinned}</option>}
            {LOCAL_RUNTIMES.map((r) => (
              <option key={r.id} value={localModelRef(r.id)}>
                {r.label}
              </option>
            ))}
          </Select>
          </div>
        </Row>
        <Row label="Tools">
          <div className="flex flex-wrap gap-1.5">
            {(options?.tools ?? []).map((t) => (
              <Chip key={t.id} size="lg" color={value.tools.includes(t.id) ? ON : undefined} title={t.description} onClick={() => {
                const tools = toggle(value.tools, t.id);
                save({ tools }, { tools });
              }}>
                {t.label}
              </Chip>
            ))}
          </div>
        </Row>
        {connectors.length > 0 && (
          <Row label="Connectors">
            <div className="flex flex-wrap gap-1.5">
              {connectors.map((c) => (
                <Chip key={c.name} size="lg" color={value.connectors.includes(c.name) ? ON : undefined} onClick={() => {
                  const next = toggle(value.connectors, c.name);
                  save({ connectors: next }, { connectors: next });
                }}>
                  {c.name}
                </Chip>
              ))}
            </div>
          </Row>
        )}
        <Row label="Group">
          <div className="max-w-xs">
          <Input
            className="text-sm"
            value={group}
            placeholder="None"
            onChange={(e) => setGroup(e.target.value)}
            onBlur={() => {
              const next = group.split(',').map((t) => t.trim()).filter(Boolean);
              if (next.join(',') !== tags.join(',')) saveTags(next);
            }}
          />
          </div>
        </Row>
        {isAdmin && (
          <Row label="Monthly cap">
            <div className="w-28">
            <Input className="text-sm" inputMode="decimal" placeholder="None" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => void saveCap()} />
            </div>
          </Row>
        )}
      </fieldset>

      {/* The machine's live screen and terminal. Admins only — a terminal is
          not a member's surface. */}
      {isAdmin && (
        <section>
          <MachinePane spaceId={spaceId} agentName={agent.name} autoWatch={liveRun} />
        </section>
      )}
    </div>
  );
}
