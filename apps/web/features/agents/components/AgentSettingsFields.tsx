'use client';

import { LOCAL_RUNTIMES, localModelRef, localRuntimeOf } from '@/lib/agents/local';
import { useState } from 'react';
import { Chip, Field, Input } from '@/components/ui';
import Select from '@/components/ui/Select';
import Toggle from '@/components/ui/Toggle';
import type { AgentOptions } from '@/lib/agents/options';
import type { BriefSettings } from '@/lib/agents/briefEdit';
import type { AgentToolExtra } from '@/lib/agents/config';

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
  // The comma-separated text as typed: parsing on every keystroke would eat
  // the comma the person just pressed.
  const [tagsText, setTagsText] = useState(value.tags.join(', '));

  const toggleTool = (id: AgentToolExtra, on: boolean) =>
    onChange({ ...value, tools: on ? [...new Set([...value.tools, id])] : value.tools.filter((t) => t !== id) });
  const toggleConnector = (name: string, on: boolean) =>
    onChange({ ...value, connectors: on ? [...new Set([...value.connectors, name])] : value.connectors.filter((c) => c !== name) });

  const usableConnectors = options?.connectors ?? [];

  // The models this space HAS, and the one an agent that picks none runs on.
  // There is no provider picker any more: a provider is a place to send a
  // request, and picking one the space has no key for is how a brief came to
  // name a model nobody could run.
  const models = options?.models ?? [];
  const pinned = value.model.trim();
  // A pin that names something the space no longer has still has to show, or
  // the form would silently rewrite the brief to "the space's model" the first
  // time somebody opened it to change the description.
  const localPin = localRuntimeOf(pinned);
  const orphanPin = pinned && !localPin && !models.some((m) => m.ref === pinned) ? pinned : null;

  return (
    <div className="flex flex-col gap-5">
      <Field label="Model">
        {options && models.length === 0 && (
          // Nothing of the space's to choose. Saying so beats a picker offering
          // providers the space has never signed up for — which is what put
          // "gemini" in briefs written in spaces that had no Gemini key. A
          // member's own plan is still offered below: it needs nothing here.
          <p className="mb-2 text-[13px] text-text-secondary">
            No model in this space yet.{' '}
            {isAdmin && (
              <a href="/admin?section=connectors" className="font-medium text-text-primary underline underline-offset-2">
                Add one
              </a>
            )}
          </p>
        )}
        {(
          <Select
            value={pinned}
            onChange={(e) => onChange({ ...value, model: e.target.value })}
            aria-label="Model"
          >
            <option value="">
              {options?.spaceModel ? `The space's model — ${options.spaceModel.label}` : 'The space\u2019s model'}
            </option>
            {models.map((m) => (
              <option key={m.name} value={m.ref ?? ''} disabled={!m.ref || m.problem !== null}>
                {m.providerLabel} · {m.label}
                {m.pricing ? ` · $${m.pricing.inputPerM}/$${m.pricing.outputPerM} per M` : ''}
                {m.problem ? ` — ${m.problem}` : ''}
              </option>
            ))}
            {orphanPin && (
              <option value={orphanPin}>{orphanPin} — not a model this space has</option>
            )}
            {/* A member's own plan, run from the desktop app: the brief pins
                it here, and it runs when that person presses Run there. */}
            <optgroup label="Your own plan (desktop app)">
              {LOCAL_RUNTIMES.map((r) => (
                <option key={r.id} value={localModelRef(r.id)}>
                  {r.label} · via {r.binary} on your machine
                </option>
              ))}
            </optgroup>
          </Select>
        )}
      </Field>

      <Field label="Tools">
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
        <Field label="Connectors">
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

      {/* The brief's `tags:`. The first is the group the roster files it
          under — Investments, Operations — and every one reaches the
          Directory's tag filter through the agent's node. */}
      <Field label="Group">
        <Input
          value={tagsText}
          onChange={(e) => {
            setTagsText(e.target.value);
            onChange({ ...value, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) });
          }}
          placeholder="Investments"
          className="text-sm"
        />
      </Field>

      {advanced ? (
        <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
          <Toggle
            checked={value.dryRun}
            onChange={(on) => onChange({ ...value, dryRun: on })}
            label="Rehearse only — nothing is written"
          />
          <Field label="Turn cap">
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
