'use client';

import { useEffect, useRef, useState } from 'react';
import { Chip, Input, Select } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import { notesApi } from '@/features/notes/lib/notesApi';
import { LOCAL_RUNTIMES, localModelRef } from '@/lib/agents/local';
import { readBriefSettings, updateBriefSettings, type BriefSettings } from '@/lib/agents/briefEdit';
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
 * connectors, group, cap. Every row is a key of the brief's frontmatter and is
 * saved as it is changed (lib/agents/briefEdit.ts, through the ordinary notes
 * API and its gate) — there is no Save. Anything a row does not cover is the
 * note itself, on the Context tab.
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
  agent: AgentSummary & { brief: string };
  isAdmin: boolean;
  canManage: boolean;
  liveRun: boolean;
  onSchedule: () => void;
  onSaved: () => void;
}) {
  const { options } = useAgentOptions(spaceId);
  const [value, setValue] = useState<BriefSettings>(() => readBriefSettings(agent.brief));
  const [group, setGroup] = useState(value.tags.join(', '));
  const [cap, setCap] = useState(agent.spend?.budgetMonthlyCents != null ? (agent.spend.budgetMonthlyCents / 100).toFixed(2) : '');
  const [error, setError] = useState<string | null>(null);
  // Saves are chained so two quick presses write in the order they were made.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // A save elsewhere (the note, an action) shows up on reload.
  useEffect(() => {
    const next = readBriefSettings(agent.brief);
    setValue(next);
    setGroup(next.tags.join(', '));
  }, [agent.brief]);

  const save = (patch: Partial<BriefSettings>) => {
    setValue((v) => ({ ...v, ...patch }));
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        const { content } = await notesApi.read(spaceId, agent.path);
        await notesApi.write(spaceId, agent.path, updateBriefSettings(content, patch));
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save');
        setValue(readBriefSettings(agent.brief));
      }
    });
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
  const pinned = value.model.trim();
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
          <Select value={pinned} aria-label="Model" onChange={(e) => save({ model: e.target.value })}>
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
              <Chip key={t.id} size="lg" color={value.tools.includes(t.id) ? ON : undefined} title={t.description} onClick={() => save({ tools: toggle(value.tools, t.id) })}>
                {t.label}
              </Chip>
            ))}
          </div>
        </Row>
        {connectors.length > 0 && (
          <Row label="Connectors">
            <div className="flex flex-wrap gap-1.5">
              {connectors.map((c) => (
                <Chip key={c.name} size="lg" color={value.connectors.includes(c.name) ? ON : undefined} onClick={() => save({ connectors: toggle(value.connectors, c.name) })}>
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
              const tags = group.split(',').map((t) => t.trim()).filter(Boolean);
              if (tags.join(',') !== value.tags.join(',')) save({ tags });
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
