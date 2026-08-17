'use client';

import { useMemo, useState } from 'react';
import { Button, Field, Input, Modal } from '@/components/ui';
import Select from '@/components/ui/Select';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/**
 * Turning an agent on is the one action that starts spending money on a
 * schedule with declared connector reach, so it is a dialog, not an optimistic
 * flip: the admin sees exactly what they are approving (brief, model, reach,
 * schedule), the key is checked before anything is written, and the toggle
 * only moves once the server says so.
 */
export default function ActivateAgentDialog({
  spaceId,
  agent,
  spaceTimezone,
  onClose,
  onDone,
}: {
  spaceId: string;
  agent: AgentSummary;
  spaceTimezone: string | null;
  onClose: () => void;
  onDone: (warning: string | null) => void;
}) {
  const initial = agent.activation.schedule;
  const [kind, setKind] = useState<'hourly' | 'daily' | 'weekly'>(initial?.kind ?? 'daily');
  const [at, setAt] = useState(
    initial && initial.kind !== 'hourly'
      ? `${String(initial.hour).padStart(2, '0')}:${String(initial.minute).padStart(2, '0')}`
      : '07:00',
  );
  const [on, setOn] = useState(initial?.kind === 'weekly' ? WEEKDAYS[(initial.weekday + 6) % 7] : 'monday');
  const [timezone, setTimezone] = useState(agent.activation.timezone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['UTC'];
    }
  }, []);

  const effectiveTz = timezone || spaceTimezone || 'UTC';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetchJson<{ ok: true; warning: string | null }>(`/api/communities/${spaceId}/agents/${encodeURIComponent(agent.name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: true, schedule: kind, at, on, timezone: timezone || null }),
      });
      onDone(res.warning);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activation failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={`Activate ${agent.title || agent.name}`}
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" size="sm" onClick={submit} loading={busy} loadingText="Checking key…">
            Activate
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4 text-sm">
        <div className="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-text-muted">
          <p className="text-text-primary">
            This agent will run <span className="font-semibold">unattended</span> on this space&apos;s{' '}
            <span className="font-mono">{agent.model ?? 'model'}</span> key
            {agent.connectors.length > 0 ? (
              <>
                {' '}with reach to <span className="font-mono">{agent.connectors.join(', ')}</span>
              </>
            ) : (
              <> with no connectors</>
            )}
            {agent.tools.includes('web') ? ', and may fetch public web pages' : ''}.
          </p>
          <p className="mt-1">You are approving the brief exactly as it is now — a member&apos;s later edit switches it off again.</p>
        </div>

        <Field label="Schedule">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="hourly">Every hour</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </Select>
        </Field>

        {kind !== 'hourly' && (
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

        {kind !== 'hourly' && (
          <Field label="Timezone" hint={timezone ? undefined : `Using the space default: ${spaceTimezone ?? 'UTC'}`}>
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="">Space default ({spaceTimezone ?? 'UTC'})</option>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <p className="text-xs text-text-muted">
          {kind === 'hourly' ? 'Fires at the top of every hour.' : `Fires at ${at} ${effectiveTz}${kind === 'weekly' ? ` on ${on}s` : ' every day'}. Missed runs are skipped, never replayed.`}
        </p>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
