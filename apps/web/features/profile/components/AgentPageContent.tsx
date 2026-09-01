'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDownIcon, PlayIcon } from '@/features/shared/icons';
import { Alert, Button, Input, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentReadiness, AgentSubscriber, AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import AgentSettingsPanel from '@/features/agents/components/AgentSettingsPanel';
import MachinePane from '@/features/agents/components/MachinePane';
import MessageAgent from '@/features/agents/components/MessageAgent';
import RunPane from '@/features/agents/components/RunPane';
import RunsForPanel, { ConnectorReadinessNotices } from '@/features/agents/components/RunsForPanel';
import SkillsPanel from '@/features/agents/components/SkillsPanel';
import StatusDot from '@/features/agents/components/StatusDot';
import { fmtAgo, fmtCents, fmtDuration, setupBlocker, statusLine, terminalLabel } from '@/features/agents/lib/rowState';

/**
 * The first tab of an agent's node page: what the note alone can't say. The
 * brief itself is the note (Context / Raw tabs); this tab is the status line
 * with its switch and play control, then one line for when it runs — the
 * schedule with a Change beside it, or, while it is off, the one thing
 * standing in the way with the switch beside that; the brief's settings,
 * folded; spend (admins); what the agent has been taught; a box to say
 * something to it; and its latest runs, each a link into the agent's WINDOW
 * on /agents — where a run is watched, steps and machine together. This tab
 * is about the agent as a thing to configure; the window is the agent at work.
 */
type AgentDetail = AgentSummary & {
  brief: string;
  heartbeatAt: string | null;
  subscribers: AgentSubscriber[];
  viewerSubscribed: boolean;
  readiness: AgentReadiness;
};

interface DetailResponse {
  agent: AgentDetail;
  runs: SerializedRun[];
  isAdmin: boolean;
  canManage: boolean;
}

function runTone(r: SerializedRun): 'live' | 'bad' | 'ok' {
  return r.status === 'running' ? 'live' : r.status === 'failed' ? 'bad' : 'ok';
}

export default function AgentPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('agent:') ? nodeId.slice('agent:'.length) : nodeId;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const runParam = params.get('run');
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>('');

  // The run being watched rides the URL beside `?tab=`, so a `watch` href from
  // an action or a teammate opens exactly the run it names, and
  // a reload lands back on it.
  const selectRun = useCallback(
    (runId: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (runId) next.set('run', runId);
      else next.delete('run');
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

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

  // While a run is in flight the row and the list move; keep them fresh. The
  // live panel follows the run itself more closely (every 2 s); this is for
  // the status line and, once the run ends, the history row taking its place.
  useEffect(() => {
    if (!data || data.agent.state.status !== 'running') return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);

  if (spaceLoading || loading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (error || !data) return <Alert>{error ?? 'Not found'}</Alert>;

  const { agent, runs, isAdmin, canManage } = data;
  const line = statusLine(agent);
  const liveRun = runs.find((r) => r.status === 'running') ?? null;
  const blocker = agent.activation.active ? null : setupBlocker(agent, isAdmin);
  const runnable = canManage && agent.activation.active && agent.state.status !== 'running' && !agent.invalid;
  // What the run section shows: the run in flight, else the one the URL names,
  // else the latest. A live run always wins — watching it is why you are here.
  const shownRun = liveRun ?? runs.find((r) => r.id === runParam) ?? runs[0] ?? null;
  const maxTurns = /^max_turns:\s*(\d+)/m.exec(agent.brief)?.[1];
  // Who a run acted as, for the history line — a fan-out group is one row per
  // person, and the name is what tells them apart.
  const personOf = new Map<string, string | null>(agent.subscribers.map((s) => [s.userId, s.name]));
  if (agent.readiness.runAsUserId) personOf.set(agent.readiness.runAsUserId, agent.readiness.runAsName);
  const editBrief = () => router.replace(`/directory/${encodeURIComponent(nodeId)}?tab=context`);

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
    // The run row exists before the executor starts, so the first reload puts
    // the live panel up while this request is still waiting on the outcome.
    const t = setInterval(reload, 1500);
    try {
      const res = await fetchJson<{ ok: true; runId: string; outcome: { status: string; reason: string } | null; error: string | null }>(
        `/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/run`,
        { method: 'POST' },
      );
      selectRun(res.runId);
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
    // Wider for an admin: the run's steps and the machine beside them are two
    // columns, and squeezing a terminal into a 3xl column reads as broken.
    <div className={`mx-auto flex w-full flex-col gap-8 pb-16 ${isAdmin ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <StatusDot tone={line.tone} />
          <p className={`min-w-0 flex-1 truncate text-sm ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-primary'}`}>
            {line.text}
          </p>
          {canManage && (
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
            disabled={!canManage || busy || !!agent.invalid}
            aria-label={canManage ? (agent.activation.active ? 'Turn off' : 'Turn on') : 'Someone who can edit the brief turns it on'}
            onChange={(next) => (next ? setActivating(true) : deactivate())}
          />
        </div>
        {agent.description && <p className="pl-5 text-[13px] text-text-muted">{agent.description}</p>}
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

      <section className="flex flex-col gap-2 border-t border-border-subtle pt-5 text-[13px]">
        <div className="flex items-center gap-3">
          <p className={`min-w-0 flex-1 ${blocker ? 'text-amber-700' : 'text-text-primary'}`}>
            {agent.activation.active ? (
              <>
                Runs {agent.activation.scheduleLabel.replace(/^No schedule$/, 'on triggers only')}
                {agent.activation.triggersLabel ? ` · ${agent.activation.triggersLabel}` : ''}
              </>
            ) : blocker ? (
              <>
                {blocker.text}
                {blocker.fix === 'brief' ? (
                  <>
                    {' — '}
                    <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={editBrief}>
                      edit the brief
                    </button>
                  </>
                ) : (
                  isAdmin && (
                    <>
                      {' — '}
                      <Link href="/admin?section=connectors" className="font-semibold text-brand-dark-green hover:underline">
                        add it under Connectors
                      </Link>
                    </>
                  )
                )}
              </>
            ) : canManage ? (
              'Not on yet — turning it on is where the schedule is picked.'
            ) : (
              'Not on yet — someone who can edit the brief turns it on and picks when it runs.'
            )}
          </p>
          {canManage &&
            (agent.activation.active ? (
              <button type="button" className="shrink-0 font-semibold text-brand-dark-green hover:underline" onClick={() => setActivating(true)}>
                Change
              </button>
            ) : (
              <Button variant="brand" size="sm" onClick={() => setActivating(true)} disabled={!!blocker}>
                Turn on
              </Button>
            ))}
        </div>
        <p className="font-mono text-[12px] text-text-muted">
          {[agent.model, ...agent.connectors, ...agent.tools].filter(Boolean).join(' · ')}
        </p>
        {/* The Turn-on preflight for the identity SCHEDULED runs act as: when
            that is somebody other than the viewer, say what THEY still have to
            connect — before the 3am run discovers it instead. The viewer's own
            check lives in the Runs-for section below. */}
        {agent.readiness.runAs && (
          <ConnectorReadinessNotices items={agent.readiness.runAs} mine={false} who={agent.readiness.runAsName} isAdmin={isAdmin} />
        )}
      </section>

      {spaceId && (
        <section className="border-t border-border-subtle pt-5">
          <RunsForPanel
            spaceId={spaceId}
            agentName={name}
            subscribers={agent.subscribers}
            viewerSubscribed={agent.viewerSubscribed}
            readiness={agent.readiness}
            isAdmin={isAdmin}
            onChanged={() => void reload()}
          />
        </section>
      )}


      {canManage && spaceId && (
        <section className="border-t border-border-subtle pt-5">
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left text-[13px] font-semibold text-text-primary"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((o) => !o)}
          >
            <ChevronDownIcon className={`h-3.5 w-3.5 text-text-muted transition-transform ${settingsOpen ? 'rotate-180' : ''}`} />
            Settings
            <span className="font-normal text-text-muted">— model, tools, connectors</span>
          </button>
          {settingsOpen && (
            <div className="mt-4 pl-5">
              <AgentSettingsPanel spaceId={spaceId} agent={agent} isAdmin={isAdmin} onSaved={() => void reload()} />
              <p className="mt-3 text-[13px] text-text-muted">
                The brief itself — what it reads, produces and writes — is the note:{' '}
                <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={editBrief}>
                  edit it on the Context tab
                </button>
                .
              </p>
            </div>
          )}
        </section>
      )}

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

      {spaceId && agent.activation.active && (
        <section className="border-t border-border-subtle pt-5">
          <MessageAgent spaceId={spaceId} agentName={name} />
        </section>
      )}

      {spaceId && (
        <section className="border-t border-border-subtle pt-5">
          <SkillsPanel spaceId={spaceId} agentName={name} isAdmin={isAdmin} />
        </section>
      )}

      {spaceId && (
        <section className="flex flex-col gap-4 border-t border-border-subtle pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {shownRun?.status === 'running' ? 'Running now' : 'Runs'}
          </p>

          {/* The run and the machine are one story: the steps carry the
              machine's record nested under each command, and the screen and
              terminal beside them are the same machine live. Admins only —
              a terminal is not a member's surface. */}
          <div className={`grid gap-8 ${isAdmin ? 'xl:grid-cols-[minmax(0,3fr)_minmax(18rem,2fr)]' : ''}`}>
            <div className="min-w-0">
              {shownRun ? (
                <RunPane
                  key={shownRun.id}
                  spaceId={spaceId}
                  agentName={name}
                  runId={shownRun.id}
                  maxTurns={maxTurns ? Number(maxTurns) : null}
                  isAdmin={isAdmin}
                  onFinished={() => void reload()}
                />
              ) : (
                <p className="text-[13px] text-text-muted">
                  No runs yet.{' '}
                  {runnable
                    ? 'Press Run to watch its first one here.'
                    : agent.activation.active
                      ? 'The first one appears here when it fires.'
                      : 'Turn it on and its runs appear here.'}
                </p>
              )}
            </div>
            {isAdmin && <MachinePane spaceId={spaceId} agentName={name} autoWatch={!!liveRun} />}
          </div>

          {runs.length > 1 && (
            <ul className="divide-y divide-border-subtle border-t border-border-subtle pt-1">
              {runs.slice(0, 8).map((r) => {
                const open = shownRun?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      aria-current={open ? 'true' : undefined}
                      className={`flex w-full items-center gap-3 py-2 text-left text-[13px] ${open ? 'text-text-primary' : 'hover:text-text-primary'}`}
                      onClick={() => selectRun(r.id === liveRun?.id ? null : r.id)}
                    >
                      <StatusDot tone={runTone(r)} />
                      <span className={`font-medium ${r.status === 'failed' ? 'text-red-600' : open ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {r.status === 'running' ? 'Running' : terminalLabel(r.terminalReason) || r.status}
                      </span>
                      <span className="min-w-0 truncate text-text-muted">
                        {fmtAgo(r.startedAt)} · {r.trigger}
                        {r.runAsUserId && personOf.get(r.runAsUserId) ? ` · for ${personOf.get(r.runAsUserId)}` : ''}
                        {r.input?.dryRun ? ' · dry run' : ''}
                        {r.input?.writes?.length ? ` · ${r.input.writes.length} note${r.input.writes.length === 1 ? '' : 's'}` : ''}
                        {r.summary ? ` — ${r.summary.split('\n')[0]}` : ''}
                      </span>
                      <span className="ml-auto shrink-0 tabular-nums text-text-muted">
                        {[fmtDuration(r.startedAt, r.endedAt), isAdmin && r.costCents !== null ? fmtCents(r.costCents) : null].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

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
