'use client';

import { useState } from 'react';
import { Chip, Field, Input } from '@/components/ui';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import type { AgentOptions } from '@/lib/agents/options';
import type { BriefSettings } from '@/lib/agents/briefEdit';
import type { AgentToolExtra } from '@/lib/agents/config';
import { splitModelRef } from '../lib/useAgentOptions';

/**
 * The settings a brief's frontmatter holds, as a form on the agent's page:
 * model, tool extras, connectors, the roster line, and — folded — dry run and
 * the turn cap. Four labels, because tools and connectors are a set of names
 * you switch on rather than a list of paragraphs: a chip that is on says so by
 * being painted, and what each one means is its tooltip.
 *
 * The prose (the brief itself) is never here: it is the note body, written in
 * the editor.
 */
/** A chip that is on is painted in the brand colour; off is the neutral chip. */
const ON = 'var(--color-brand-green)';

export default function AgentSettingsFields({
  value,
  onChange,
  options,
  isAdmin,
}: {
  value: BriefSettings;
  onChange: (next: BriefSettings) => void;
  options: AgentOptions | null;
  isAdmin: boolean;
}) {
  // Unfolded only when something non-default is set: every scaffolded brief
  // carries `max_turns: 16`, which is the default and not worth a fold.
  const [advanced, setAdvanced] = useState(value.dryRun || (value.maxTurns !== null && value.maxTurns !== 16));
  const { provider: providerId, modelId } = splitModelRef(value.model);
  const provider = options?.providers.find((p) => p.id === providerId) ?? null;
  const knownModel = provider?.models.some((m) => m.id === modelId) ?? false;
  const keyMissing = provider ? !provider.keyStored : false;
  const endpointMissing = provider ? !provider.endpointConfigured : false;

  const setProvider = (id: string) => {
    const next = options?.providers.find((p) => p.id === id);
    const first = next?.models[0]?.id ?? '';
    onChange({ ...value, model: first ? `${id}/${first}` : `${id}/` });
  };
  const setModelId = (id: string) => onChange({ ...value, model: `${providerId || 'gemini'}/${id}` });
  const toggleTool = (id: AgentToolExtra, on: boolean) =>
    onChange({ ...value, tools: on ? [...new Set([...value.tools, id])] : value.tools.filter((t) => t !== id) });
  const toggleConnector = (name: string, on: boolean) =>
    onChange({ ...value, connectors: on ? [...new Set([...value.connectors, name])] : value.connectors.filter((c) => c !== name) });

  const usableConnectors = (options?.connectors ?? []).filter((c) => c.kind !== 'model');
  const modelHint = !provider
    ? undefined
    : endpointMissing
      ? 'Needs a custom model connector with a base_url before it can run.'
      : keyMissing
        ? isAdmin
          ? `No ${provider.label} key stored yet — add MODEL_KEY_${provider.id.toUpperCase()} under Connectors before turning it on.`
          : `No ${provider.label} key stored yet — an admin adds it under Connectors.`
        : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Model" hint={modelHint}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select value={providerId} onChange={(e) => setProvider(e.target.value)} aria-label="Model provider">
            {!provider && <option value="">Pick a provider</option>}
            {(options?.providers ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.keyStored ? '' : ' — no key yet'}
              </option>
            ))}
          </Select>
          {provider && provider.models.length > 0 && knownModel ? (
            <Select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model">
              {provider.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.pricing ? ` · $${m.pricing.inputPerM}/$${m.pricing.outputPerM} per M` : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={modelId}
              onChange={(e) => setModelId(e.target.value.trim())}
              placeholder={provider?.id === 'custom' ? 'model id at your endpoint' : 'model id'}
              aria-label="Model id"
              className="font-mono text-sm"
            />
          )}
        </div>
      </Field>

      <Field label="Tools" hint="Reading and writing notes is always on. These add reach.">
        <div className="flex flex-wrap gap-1.5">
          {(options?.tools ?? []).map((t) => {
            const on = value.tools.includes(t.id);
            return (
              <Chip key={t.id} size="lg" color={on ? ON : undefined} title={t.description} onClick={() => toggleTool(t.id, !on)}>
                {t.label}
              </Chip>
            );
          })}
        </div>
      </Field>

      {usableConnectors.length > 0 && (
        <Field label="Connectors" hint="The services this agent may call. Its runs reach nothing else.">
          <div className="flex flex-wrap gap-1.5">
            {usableConnectors.map((c) => {
              const on = value.connectors.includes(c.name);
              return (
                <Chip
                  key={c.name}
                  size="lg"
                  color={on ? ON : undefined}
                  title={c.enabled ? undefined : 'Turned off in the console'}
                  onClick={() => toggleConnector(c.name, !on)}
                >
                  {c.name}
                  {!c.enabled && ' · off'}
                </Chip>
              );
            })}
          </div>
        </Field>
      )}
      {value.connectors.some((c) => !usableConnectors.some((u) => u.name === c)) && (
        <p className="text-[13px] text-amber-700">
          Declares a connector that does not exist here: {value.connectors.filter((c) => !usableConnectors.some((u) => u.name === c)).join(', ')}.
        </p>
      )}

      <Field label="Description">
        <Input
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
          placeholder="What it does, in a sentence"
          className="text-sm"
        />
      </Field>

      {advanced ? (
        <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <Toggle
            checked={value.dryRun}
            onChange={(on) => onChange({ ...value, dryRun: on })}
            label="Rehearse only — writes are recorded in the transcript, not applied"
          />
          <Field label="Turn cap" hint="Tool calls a run may make before it stops. 1–40, default 16.">
            <Input
              className="w-28 text-sm"
              inputMode="numeric"
              value={value.maxTurns ?? ''}
              placeholder="16"
              onChange={(e) => {
                const raw = e.target.value.trim();
                const n = Number(raw);
                onChange({ ...value, maxTurns: raw === '' ? null : Number.isInteger(n) && n > 0 ? Math.min(40, n) : value.maxTurns });
              }}
            />
          </Field>
        </div>
      ) : (
        <button type="button" className="self-start text-[13px] font-semibold text-brand-dark-green hover:underline" onClick={() => setAdvanced(true)}>
          + Dry run and turn cap
        </button>
      )}
    </div>
  );
}
