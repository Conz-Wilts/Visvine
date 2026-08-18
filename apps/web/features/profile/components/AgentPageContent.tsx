'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PlayIcon } from '@/features/shared/icons';
import { Button, Input, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import RunTranscript from '@/features/agents/components/RunTranscript';
import { fmtAgo, fmtCents, rowStateView, terminalLabel, TONE_CLASSES } from '@/features/agents/lib/rowState';

/**
 * The first tab of an agent's node page: what the note alone can't say. The
 * brief itself is the note (Context / Raw tabs); this tab shows the state
 * row, the activation switch (admins), the run history with live transcripts,
 * and — for admins only — spend and the monthly budget. Mirrors
 * ConnectorPageContent in shape.
 */
type AgentDetail = AgentSummary & { brief: string; activationNote: string | null; heartbeatAt: string | null };

interface DetailResponse {
  agent: AgentDetail;
  runs: SerializedRun[];
  isAdmin: boolean;
  canRun: boolean;
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border-subtle bg-surface-1 p-4 shadow-soft">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function AgentPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('agent:') ? nodeId.slice('agent:'.length) : nodeId;
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState<string>('');
  const [spaceTimezone, setSpaceTimezone] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await fetchJson<DetailResponse>(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}`);
      setData(next);
      setError(null);
      if (next.agent.spend?.budgetMonthlyCents != null) setBudgetInput((next.agent.spend.budgetMonthlyCents / 100).toFixed(2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the agent');
    } finally {
      setLoading(false);
    }
  }, [spaceId, name]);

  useEffect(() => {
    if (spaceLoading) return;
    if (!spaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload();
    // The space timezone (for the activation dialog) rides on the roster route.
    fetchJson<{ spaceTimezone: string | null }>(`/api/communities/${spaceId}/agents`)
      .then((r) => setSpaceTimezone(r.spaceTimezone))
      .catch(() => {});
  }, [spaceId, spaceLoading, reload]);

  // While a run is in flight the row and the list move; keep them fresh.
  useEffect(() => {
    if (!data || data.agent.state.status !== 'running') return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);

  if (spaceLoading || loading) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (error || !data) return <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">{error ?? 'Not found'}</div>;

  const { agent, runs, isAdmin, canRun } = data;
  const view = rowStateView(agent);
  const runnable = canRun && agent.activation.active && agent.state.status !== 'running' && !agent.invalid;

  const deactivate = async () => {
    if (!spaceId) return;
    setBusy(true);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not deactivate');
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!spaceId) return;
    setBusy(true);
    setNotice(`Running…`);
    const t = setInterval(reload, 3000);
    try {
      const res = await fetchJson<{ ok: true; runId: string; outcome: { status: string; reason: string } | null; error: string | null }>(
        `/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/run`,
        { method: 'POST' },
      );
      setOpenRun(res.runId);
      setNotice(res.error ?? (res.outcome ? `Run ${res.outcome.status}: ${terminalLabel(res.outcome.reason)}` : null));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Run failed');
    } finally {
      clearInterval(t);
      setBusy(false);
      void reload();
    }
  };

  const saveBudget = async () => {
    if (!spaceId) return;
    const dollars = budgetInput.trim() === '' ? null : Number(budgetInput);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setNotice('Budget must be a dollar amount, or empty for no cap.');
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/budget`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: dollars === null ? null : Math.round(dollars * 100) }),
      });
      setNotice('Budget saved.');
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save the budget');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-16">
      {notice && <div className="rounded-2xl bg-surface-2 px-4 py-2.5 text-[13px] text-text-primary">{notice}</div>}

      <Section
        title="Status"
        aside={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full border border-border-default px-2.5 py-1 text-[12px] font-medium text-text-primary hover:border-brand-green disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!runnable || busy}
            onClick={runNow}
            title={!agent.activation.active ? 'Activate the agent first' : !canRun ? 'Only the author or an admin can run it' : 'Run now'}
          >
            <PlayIcon className="h-3 w-3" /> Run now
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[view.tone]}`}>{view.label}</span>
          <span className="text-[13px] text-text-muted">{view.detail}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="text-text-muted">Model</dt>
            <dd className="font-mono">{agent.model ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Connectors</dt>
            <dd className="font-mono">{agent.connectors.length ? agent.connectors.join(', ') : 'none'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Extras</dt>
            <dd className="font-mono">{agent.tools.length ? agent.tools.join(', ') : 'none'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Schedule</dt>
            <dd>{agent.activation.schedule ? agent.activation.scheduleLabel : 'not set'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Next run</dt>
            <dd>{agent.state.nextRunAt ? new Date(agent.state.nextRunAt).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Last run</dt>
            <dd>{agent.lastRun ? `${terminalLabel(agent.lastRun.terminalReason) || agent.lastRun.status} · ${fmtAgo(agent.lastRun.startedAt)}` : 'never'}</dd>
          </div>
        </dl>
        {agent.invalid && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">Brief: {agent.invalid}</p>}
        {agent.activation.invalid && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">Activation note: {agent.activation.invalid}</p>}
        <p className="mt-3 text-[12px] text-text-muted">
          The brief is the note itself — edit it on the{' '}
          <Link className="underline" href={`/directory/${encodeURIComponent(nodeId)}?tab=context`}>
            Context
          </Link>{' '}
          tab. Anyone in the space may write it; turning it on is an admin&apos;s call.
        </p>
      </Section>

      <Section
        title="Activation"
        aside={
          <Toggle
            checked={agent.activation.active}
            disabled={!isAdmin || busy || !!agent.invalid}
            aria-label={isAdmin ? 'Toggle activation' : 'Admins only'}
            onChange={(next) => (next ? setActivating(true) : deactivate())}
          />
        }
      >
        <p className="text-[13px] text-text-muted">
          {agent.activation.active
            ? `Active — ${agent.activation.scheduleLabel}${agent.activation.timezone ? '' : ` (space timezone${spaceTimezone ? `: ${spaceTimezone}` : ''})`}. A member's edit to the brief switches it off until an admin re-activates.`
            : isAdmin
              ? 'Off. Activating means: runs unattended on this space\'s model key, with the connector reach declared in the brief.'
              : 'Off. A space admin activates agents.'}
        </p>
        {agent.state.deactivatedReason && !agent.activation.active && (
          <p className="mt-2 text-[12px] text-amber-800">
            Last deactivation: {agent.state.deactivatedReason}
            {agent.state.deactivatedDetail ? ` — ${agent.state.deactivatedDetail}` : ''}
          </p>
        )}
      </Section>

      {isAdmin && (
        <Section title="Spend">
          <div className="flex flex-wrap items-end gap-4 text-[13px]">
            <div>
              <p className="text-text-muted">This month</p>
              <p className="text-lg font-semibold tabular-nums">{fmtCents(agent.spend?.monthCents)}</p>
              {agent.spend?.monthCents === null && <p className="text-[11px] text-text-muted">no list price for this model — tokens only</p>}
            </div>
            <div className="flex items-end gap-2">
              <label className="text-text-muted">
                Monthly cap (USD)
                <Input
                  className="mt-1 w-32"
                  inputMode="decimal"
                  placeholder="no cap"
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value)}
                />
              </label>
              <Button variant="ghost" size="sm" onClick={saveBudget} disabled={busy}>
                Save
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[12px] text-text-muted">
            At the cap the agent pauses (no deactivation) and resumes next month or when raised. Members never see spend.
          </p>
        </Section>
      )}

      <Section title="Runs">
        {runs.length === 0 ? (
          <p className="text-[13px] text-text-muted">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {runs.map((r) => (
              <li key={r.id} className="py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 text-left text-[13px]"
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                >
                  <span
                    className={`w-24 shrink-0 font-medium ${
                      r.status === 'running' ? 'text-sky-700' : r.status === 'failed' ? 'text-red-700' : 'text-brand-dark-green'
                    }`}
                  >
                    {r.status === 'running' ? 'running' : terminalLabel(r.terminalReason) || r.status}
                  </span>
                  <span className="text-text-muted">{new Date(r.startedAt).toLocaleString()}</span>
                  <span className="text-text-muted">{r.trigger}</span>
                  <span className="ml-auto tabular-nums text-text-muted">
                    {r.turns}t · {isAdmin ? fmtCents(r.costCents) : ''}
                  </span>
                </button>
                {openRun === r.id && spaceId && (
                  <div className="mt-2">
                    <RunTranscript spaceId={spaceId} agentName={name} runId={r.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {activating && spaceId && (
        <ActivateAgentDialog
          spaceId={spaceId}
          agent={agent}
          spaceTimezone={spaceTimezone}
          onClose={() => setActivating(false)}
          onDone={(warning) => {
            setActivating(false);
            if (warning) setNotice(warning);
            void reload();
          }}
        />
      )}
    </div>
  );
}
