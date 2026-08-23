'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';
import Select from '@/components/ui/Select';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** The zone this browser is in, or '' when the runtime won't say. */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

type Kind = 'none' | 'hourly' | 'daily' | 'weekly' | 'every';

/**
 * Turning an agent on is the one action that starts spending money on a
 * schedule with declared connector reach, so it is a dialog, not an optimistic
 * flip: the admin picks the clock, optionally the triggers, and the key is
 * checked before anything is written. Triggers stay folded until wanted — most
 * agents just run on a clock.
 */
export default function ActivateAgentDialog({
  spaceId,
  agent,
  onClose,
  onDone,
}: {
  spaceId: string;
  agent: AgentSummary;
  onClose: () => void;
  onDone: (warning: string | null) => void;
}) {
  const initial = agent.activation.schedule;
  const initialKind: Kind =
    initial?.kind === 'interval' || initial?.kind === 'cron' ? 'every' : initial ? initial.kind : agent.activation.on ? 'none' : 'daily';
  const [kind, setKind] = useState<Kind>(initialKind);
  const [at, setAt] = useState(
    initial && (initial.kind === 'daily' || initial.kind === 'weekly')
      ? `${String(initial.hour).padStart(2, '0')}:${String(initial.minute).padStart(2, '0')}`
      : '07:00',
  );
  const [on, setOn] = useState(initial?.kind === 'weekly' ? WEEKDAYS[(initial.weekday + 6) % 7] : 'monday');
  const [every, setEvery] = useState(agent.activation.every ?? '15m');
  // Seeded from the note, then from the browser — the admin turning an agent on
  // is nearly always in the zone it should run in. It is still written out
  // explicitly; what is refused is a schedule with no zone on it at all.
  const [timezone, setTimezone] = useState(agent.activation.timezone ?? browserTimeZone());
  const [contextGlobs, setContextGlobs] = useState((agent.activation.on?.context ?? []).join('\n'));
  const [webhook, setWebhook] = useState(agent.activation.on?.webhook ?? '');
  const [debounce, setDebounce] = useState(
    agent.activation.debounceMs && agent.activation.debounceMs !== 60_000
      ? agent.activation.debounceMs % 60_000 === 0
        ? `${agent.activation.debounceMs / 60_000}m`
        : `${Math.round(agent.activation.debounceMs / 1000)}s`
      : '',
  );
  const [showTriggers, setShowTriggers] = useState(!!agent.activation.on);
  const [connectors, setConnectors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Admin-only list; the dialog is admin-only. Model connectors can't receive webhooks.
    fetchJson<{ connectors: { name: string; kind: string }[] }>(`/api/communities/${spaceId}/connectors`)
      .then((r) => setConnectors(r.connectors.filter((c) => c.kind !== 'model').map((c) => c.name)))
      .catch(() => setConnectors([]));
  }, [spaceId]);

  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  const globs = contextGlobs
    .split(/[\n,]/)
    .map((g) => g.trim())
    .filter(Boolean);
  const hasTrigger = globs.length > 0 || !!webhook;
  // Any clock needs a zone to be read in — the same line the API draws. A
  // trigger-only agent fires when something happens, so there is no "07:00"
  // to interpret and no zone to ask for.
  const needsClock = kind !== 'none';
  const canSubmit = (needsClock || hasTrigger) && (!needsClock || !!timezone);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; warning: string | null }>(`/api/communities/${spaceId}/agents/${encodeURIComponent(agent.name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          active: true,
          schedule: kind === 'every' || kind === 'none' ? null : kind,
          at,
          on,
          every: kind === 'every' ? every.trim() : null,
          triggers: hasTrigger ? { context: globs, webhook: webhook || null } : null,
          debounce: hasTrigger && debounce.trim() ? debounce.trim() : null,
          timezone: timezone || null,
        }),
      });
      onDone(res.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn on');
    } finally {
      setBusy(false);
    }
  };

  const reach = [agent.model ?? 'model', ...agent.connectors, ...(agent.tools.includes('web') ? ['public web'] : [])];

  return (
    <Modal
      onClose={onClose}
      title={agent.title || agent.name}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} loadingText="Checking key…" disabled={!canSubmit}>
            Turn on
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4 text-sm">
        <p className="text-[13px] text-text-muted">
          Runs unattended with <span className="font-mono text-text-primary">{reach.join(' · ')}</span>. Editing the brief turns it off again.
        </p>

        <Field label="Runs">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="hourly">Every hour</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="every">Every N minutes / cron</option>
            <option value="none">Only on triggers</option>
          </Select>
        </Field>

        {kind === 'every' && (
          <Field label="Every" hint="15m, 2h, or a cron line">
            <Input value={every} onChange={(e) => setEvery(e.target.value)} placeholder="15m" className="font-mono" />
          </Field>
        )}

        {(kind === 'daily' || kind === 'weekly') && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="At">
              <Input type="time" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
            {kind === 'weekly' && (
              <Field label="On">
                <Select value={on} onChange={(e) => setOn(e.target.value)}>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {d[0].toUpperCase() + d.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}

        {needsClock && (
          <Field label="Timezone" hint="Whose clock “07:00” means. Written into the agent's activation note.">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {/* No "space default": the space no longer keeps one, and a
                  schedule whose zone is implied is a schedule nobody can read
                  off the note. */}
              <option value="" disabled>
                Pick a timezone
              </option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {!showTriggers ? (
          <button type="button" className="self-start text-[13px] font-semibold text-brand-dark-green hover:underline" onClick={() => setShowTriggers(true)}>
            + Also run on changes or webhooks
          </button>
        ) : (
          <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
            <Field label="When a note changes under" hint="One glob per line">
              <textarea
                value={contextGlobs}
                onChange={(e) => setContextGlobs(e.target.value)}
                rows={2}
                placeholder={'people/**\nupdates/*.md'}
                className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] text-text-primary outline-none focus:ring-1 focus:ring-border-default"
              />
            </Field>
            <Field label="When a webhook arrives for">
              <Select value={webhook} onChange={(e) => setWebhook(e.target.value)}>
                <option value="">—</option>
                {connectors.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {webhook && !connectors.includes(webhook) && <option value={webhook}>{webhook}</option>}
              </Select>
            </Field>
            {hasTrigger && (
              <Field label="Debounce" hint="Default 60s, max 30m">
                <Input value={debounce} onChange={(e) => setDebounce(e.target.value)} placeholder="60s" className="font-mono" />
              </Field>
            )}
          </div>
        )}

        {error && <p className="border-l-2 border-red-500 pl-3 text-[13px] text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
