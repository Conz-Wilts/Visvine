'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDownIcon, PlayIcon } from '@/features/shared/icons';
import { Alert, Button, Input, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import RunTranscript from '@/features/agents/components/RunTranscript';
import StatusDot from '@/features/agents/components/StatusDot';
import { fmtAgo, fmtCents, statusLine, terminalLabel } from '@/features/agents/lib/rowState';

/**
 * The first tab of an agent's node page: what the note alone can't say. The
 * brief itself is the note (Context / Raw tabs); this tab is the status line
 * with its switch and play control, a line of facts, spend (admins), and the
 * run history with live transcripts.
 */
type AgentDetail = AgentSummary & { brief: string; activationNote: string | null; heartbeatAt: string | null };

interface DetailResponse {
  agent: AgentDetail;
  runs: SerializedRun[];
  isAdmin: boolean;
  canRun: boolean;
}

function runTone(r: SerializedRun): 'live' | 'bad' | 'ok' {
  return r.status === 'running' ? 'live' : r.status === 'failed' ? 'bad' : 'ok';
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
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');

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
  }, [spaceId, spaceLoading, reload]);

  // While a run is in flight the row and the list move; keep them fresh.
  useEffect(() => {
    if (!data || data.agent.state.status !== 'running') return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);

  if (spaceLoading || loading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (error || !data) return <Alert>{error ?? 'Not found'}</Alert>;

  const { agent, runs, isAdmin, canRun } = data;
  const line = statusLine(agent);
  const runnable = canRun && agent.activation.active && agent.state.status !== 'running' && !agent.invalid;
  const facts = [agent.model, ...agent.connectors, ...agent.tools].filter(Boolean) as string[];

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
      setNotice(e instanceof Error ? e.message : 'Could not turn off');
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    if (!spaceId) return;
    setBusy(true);
    setNotice(null);
    const t = setInterval(reload, 3000);
    try {
      const res = await fetchJson<{ ok: true; runId: string; outcome: { status: string; reason: string } | null; error: string | null }>(
        `/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/run`,
        { method: 'POST' },
      );
      setOpenRun(res.runId);
      if (res.error) setNotice(res.error);
      else if (res.outcome && res.outcome.status !== 'succeeded') setNotice(terminalLabel(res.outcome.reason));
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
      setNotice('The cap is a dollar amount, or empty for none.');
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/budget`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: dollars === null ? null : Math.round(dollars * 100) }),
      });
      setEditingBudget(false);
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save the cap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 pb-16">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <StatusDot tone={line.tone} />
          <p className={`min-w-0 flex-1 truncate text-sm ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-primary'}`}>
            {line.text}
          </p>
          {canRun && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-semibold text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!runnable || busy}
              onClick={runNow}
              title={agent.activation.active ? 'Run now' : 'Turn it on first'}
            >
              <PlayIcon className="h-3 w-3" /> Run
            </button>
          )}
          <Toggle
            checked={agent.activation.active}
            disabled={!isAdmin || busy || !!agent.invalid}
            aria-label={isAdmin ? (agent.activation.active ? 'Turn off' : 'Turn on') : 'An admin turns agents on'}
            onChange={(next) => (next ? setActivating(true) : deactivate())}
          />
        </div>
        {facts.length > 0 && <p className="truncate pl-5 font-mono text-[12px] text-text-muted">{facts.join(' · ')}</p>}
        {notice && (
          <Alert inline variant="warning" className="ml-5">
            {notice}
          </Alert>
        )}
        {agent.invalid && (
          <Alert inline className="ml-5">
            {agent.invalid}
          </Alert>
        )}
        {agent.activation.invalid && (
          <Alert inline className="ml-5">
            {agent.activation.invalid}
          </Alert>
        )}
      </section>

      {isAdmin && (
        <section className="flex items-center gap-3 border-t border-border-subtle pt-5 text-[13px]">
          <p className="text-text-primary">
            <span className="font-semibold tabular-nums">{fmtCents(agent.spend?.monthCents)}</span>
            <span className="text-text-muted"> this month</span>
          </p>
          <span className="text-border-default">·</span>
          {editingBudget ? (
            <div className="flex items-center gap-2">
              <Input
                className="w-28"
                inputMode="decimal"
                autoFocus
                placeholder="no cap"
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveBudget();
                  if (e.key === 'Escape') setEditingBudget(false);
                }}
              />
              <Button variant="ghost" size="sm" onClick={saveBudget} disabled={busy}>
                Save
              </Button>
            </div>
          ) : (
            <button type="button" className="text-text-muted hover:text-text-primary hover:underline" onClick={() => setEditingBudget(true)}>
              {agent.spend?.budgetMonthlyCents != null ? `cap ${fmtCents(agent.spend.budgetMonthlyCents)}` : 'no cap'}
            </button>
          )}
        </section>
      )}

      <section className="border-t border-border-subtle pt-5">
        {runs.length === 0 ? (
          <p className="text-[13px] text-text-muted">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {runs.map((r) => {
              const open = openRun === r.id;
              const seconds = r.endedAt ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null;
              return (
                <li key={r.id} className="py-2.5">
                  <button type="button" className="group flex w-full items-center gap-3 text-left text-[13px]" onClick={() => setOpenRun(open ? null : r.id)}>
                    <StatusDot tone={runTone(r)} />
                    <span className={`font-medium ${r.status === 'failed' ? 'text-red-600' : 'text-text-primary'}`}>
                      {r.status === 'running' ? 'Running' : terminalLabel(r.terminalReason) || r.status}
                    </span>
                    <span className="truncate text-text-muted">
                      {fmtAgo(r.startedAt)} · {r.trigger}
                      {r.input?.dryRun ? ' · dry run' : ''}
                      {r.input?.writes?.length ? ` · ${r.input.writes.length} note${r.input.writes.length === 1 ? '' : 's'}` : ''}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-text-muted">
                      {[seconds !== null ? `${seconds}s` : null, isAdmin && r.costCents !== null ? fmtCents(r.costCents) : null].filter(Boolean).join(' · ')}
                    </span>
                    <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && spaceId && (
                    <div className="mt-3">
                      <RunTranscript spaceId={spaceId} agentName={name} runId={r.id} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activating && spaceId && (
        <ActivateAgentDialog
          spaceId={spaceId}
          agent={agent}
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
