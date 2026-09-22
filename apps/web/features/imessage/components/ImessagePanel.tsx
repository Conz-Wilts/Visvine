'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, ConfirmDialog, Input, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import NewRow from '@/components/ui/NewRow';
import SpaceLink from '@/features/shared/components/SpaceLink';
import { fetchJson, fetchJsonBody } from '@/lib/fetchJson';
import { inflightFetch, invalidateRequestCache } from '@/features/shared/lib/requestCache';
import { TONE_CHIP, TONE_CLASSES } from '@/features/shared/lib/statusTone';
import { agentPageHref } from '@/lib/agents/config';
import { PHONE_AGENT } from '@/lib/imessage/shared/brief';

/**
 * Console → iMessage: the space's number and what texting it does
 * (docs/imessage.md). The switch is in the header. The body is the line, the
 * agent that answers it, and one muted line of state; a warning appears only
 * when something is actually wrong. Assigning the line is a super-admin's
 * act, so those controls exist only for one.
 */
interface State {
  configured: boolean;
  line: { number: string; name: string | null; status: 'active' | 'suspended'; profileAt: string | null } | null;
  enabled: boolean;
  agent: { path: string } | null;
  modelProblem: string | null;
  linked: number;
  rooms: Array<{ id: string; name: string }>;
  canAssign: boolean;
}

const ROW = '-mx-3 flex min-h-11 items-center gap-3 rounded-lg px-3 py-1.5';

export default function ImessagePanel({ space }: { space: string }) {
  const key = `space:${space}:imessage`;
  const url = `/api/spaces/${encodeURIComponent(space)}/imessage`;
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [number, setNumber] = useState('');
  const [accountLines, setAccountLines] = useState<string[] | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await inflightFetch(key, () => fetchJson<State>(url));
      setData(next);
      setName(next.line?.name ?? '');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load iMessage.');
    }
  }, [key, url]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: { enabled?: boolean; name?: string | null }) => {
    setData((d) => d && { ...d, ...(body.enabled !== undefined ? { enabled: body.enabled } : {}) });
    try {
      setData(await fetchJsonBody<State>(url, 'PATCH', body));
      invalidateRequestCache(key);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
      void load();
    }
  };

  const assign = async () => {
    setBusy('assign');
    try {
      await fetchJsonBody(`${url}/line`, 'PUT', { number });
      invalidateRequestCache(key);
      setAssigning(false);
      setNumber('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign that line.');
    } finally {
      setBusy(null);
    }
  };

  const openAssign = async () => {
    setAssigning(true);
    try {
      const r = await fetchJson<{ lines: string[] | null }>(`${url}/line`);
      setAccountLines(r.lines);
    } catch {
      setAccountLines(null);
    }
  };

  const remove = async () => {
    await fetchJson(`${url}/line`, { method: 'DELETE' });
    invalidateRequestCache(key);
    setRemoving(false);
    await load();
  };

  const addAgent = async () => {
    setBusy('agent');
    try {
      await fetchJson(`${url}/agent`, { method: 'POST' });
      invalidateRequestCache(key);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the agent.');
    } finally {
      setBusy(null);
    }
  };

  if (!data && !error) return <Skeleton className="h-40 w-full" />;
  if (!data) return <Alert variant="error">{error}</Alert>;

  const ready = data.configured && data.line?.status === 'active' && data.agent && !data.modelProblem;
  const state = [
    'Runs as the texter',
    `${data.linked} linked`,
    data.rooms.length ? `also answers ${data.rooms.map((r) => r.name).join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="mb-1 text-base font-semibold text-text-primary">iMessage</h3>
          <p className="text-xs text-text-muted">{state}</p>
        </div>
        <Toggle aria-label="iMessage on" checked={data.enabled} onChange={(on) => void patch({ enabled: on })} disabled={!data.line} />
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {!data.configured && <Alert variant="warning">Sendblue is not configured on this deployment.</Alert>}
      {data.line?.status === 'suspended' && <Alert variant="warning">This line is suspended.</Alert>}
      {data.line && data.modelProblem && <Alert variant="warning">{data.modelProblem}</Alert>}

      <ul className="divide-y divide-border-subtle border-t border-border-subtle">
        {data.line ? (
          <li className="py-0.5">
            <div className={ROW}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">{data.line.number}</p>
                <Input
                  aria-label="Shown name"
                  placeholder="Name shown in Messages"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => {
                    const next = name.trim() || null;
                    if (next !== (data.line?.name ?? null)) void patch({ name: next });
                  }}
                  className="mt-1 h-8 max-w-xs text-xs"
                />
              </div>
              {ready ? (
                <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES[data.enabled ? 'ok' : 'muted']}`}>{data.enabled ? 'On' : 'Off'}</span>
              ) : (
                <span className={`shrink-0 ${TONE_CHIP} ${TONE_CLASSES.warn}`}>Not ready</span>
              )}
              {data.canAssign && (
                <Button variant="danger-text" size="sm" onClick={() => setRemoving(true)}>
                  Remove
                </Button>
              )}
            </div>
          </li>
        ) : data.canAssign ? (
          <li className="py-0.5">
            {assigning ? (
              <div className="flex flex-col gap-2 py-2">
                {accountLines && accountLines.length > 0 && (
                  <ul className="flex flex-wrap gap-2">
                    {accountLines.map((n) => (
                      <li key={n}>
                        <Button variant="neutral" size="sm" onClick={() => setNumber(n)}>
                          {n}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <Input aria-label="Line" placeholder="+1…" value={number} onChange={(e) => setNumber(e.target.value)} className="max-w-xs" />
                  <Button variant="brand" size="sm" disabled={!number.trim() || busy === 'assign'} onClick={() => void assign()}>
                    Assign
                  </Button>
                  <Button variant="neutral" size="sm" onClick={() => setAssigning(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <NewRow label="Assign a line" onClick={() => void openAssign()} />
            )}
          </li>
        ) : (
          <li className="py-2 text-sm text-text-muted">No line yet.</li>
        )}

        {data.agent ? (
          <li className="py-0.5">
            <SpaceLink href={agentPageHref(PHONE_AGENT, null, space)} className={`${ROW} transition-colors hover:bg-surface-2`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-text-primary">Phone agent</p>
                <p className="truncate text-xs text-text-muted">{data.agent.path}</p>
              </div>
            </SpaceLink>
          </li>
        ) : (
          <li className="py-0.5">
            <NewRow label="Add the phone agent" onClick={() => void addAgent()} disabled={busy === 'agent'} />
          </li>
        )}
      </ul>

      <ConfirmDialog
        open={removing}
        title={`Remove ${data.line?.number ?? 'the line'}?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void remove()}
        onClose={() => setRemoving(false)}
      />
    </div>
  );
}
