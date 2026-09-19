'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSpaceRouter } from '@/features/shared/hooks/useSpaceRouter';
import { PlayIcon } from '@/features/shared/icons';
import { Alert, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import { useAuth } from '@/features/auth/contexts/AuthContext';
import { SharePanel } from '@/features/notes/components/SharePanel';
import { cachedFetch } from '@/features/shared/lib/requestCache';
import { agentBriefPath } from '@/lib/agents/config';
import type { AgentReadiness, AgentSubscriber, AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import AgentConfig from '@/features/agents/components/AgentConfig';
import AgentHistory from '@/features/agents/components/AgentHistory';
import AgentTrail, { type AgentView } from '@/features/agents/components/AgentTrail';
import AgentNeeds from '@/features/agents/components/AgentNeeds';
import ConnectorReadinessNotices from '@/features/agents/components/ConnectorReadinessNotices';
import RunsForSection from '@/features/agents/components/RunsForSection';
import RunPane from '@/features/agents/components/RunPane';
import StatusDot from '@/features/agents/components/StatusDot';
import LocalRunPane from '@/features/agents/components/LocalRunPane';
import { fmtAgo, setupBlocker, statusLine, terminalLabel } from '@/features/agents/lib/rowState';
import { desktopRuntimes } from '@/features/desktop/lib/desktop';
import { LOCAL_RUNTIMES, localRuntimeOf } from '@/lib/agents/local';

/**
 * The first tab of an agent's node page: what the note alone can't say.
 *
 * One column, one subject. The name with its switch, Run, Share and the gear;
 * one line for how it is; then THE RUN — a short list of what the agent set
 * out to do, each opening onto the calls it made — because that is what a
 * person opens this page to see. Which run it is, and the way to an older
 * one, is the word at the end of the run's own line.
 *
 * Who it runs for is part of sharing it, so it lives in Share. Everything you
 * configure or look into rather than watch — model, tools, connectors, the
 * cap, memory, skills, the machine's own screen — is behind the gear.
 *
 * The brief itself is the note, on the Context and Raw tabs beside this one.
 */
type AgentDetail = AgentSummary & {
  brief: string;
  memory: string | null;
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

export default function AgentPageContent({ nodeId }: { nodeId: string }) {
  const name = nodeId.startsWith('agent:') ? nodeId.slice('agent:'.length) : nodeId;
  const router = useSpaceRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const runParam = params.get('run');
  const viewParam = params.get('view');
  const view: AgentView = viewParam === 'config' || viewParam === 'history' ? viewParam : 'run';
  const { currentSpace, loading: spaceLoading } = useSpace();
  const spaceId = currentSpace?.id;

  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A run on the member's own plan, in flight on this machine — keyed by the
  // press that started it, so each Run is its own pane.
  const [localRun, setLocalRun] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [models, setModels] = useState<{ ref: string; label: string }[]>([]);
  const { session } = useAuth();

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

  // Which of the page's three screens is up rides the URL too; choosing a run
  // from History lands back on the run.
  const go = useCallback(
    (nextView: AgentView, runId?: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (nextView === 'run') next.delete('view');
      else next.set('view', nextView);
      if (runId !== undefined) {
        if (runId) next.set('run', runId);
        else next.delete('run');
      }
      const q = next.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const reload = useCallback(async () => {
    if (!spaceId) return;
    try {
      const next = await fetchJson<DetailResponse>(`/api/spaces/${spaceId}/agents/${encodeURIComponent(name)}`);
      setData(next);
      setError(null);
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

  // While a run is in flight the status line and the history move; keep them
  // fresh. The run pane follows the run itself more closely (every 2 s).
  useEffect(() => {
    if (!data || data.agent.state.status !== 'running') return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [data, reload]);

  // The models a person may pick for their own runs: read when Share opens.
  useEffect(() => {
    if (!sharing || !spaceId) return;
    let live = true;
    void cachedFetch<{ models: { ref: string | null; label: string; problem: string | null }[] }>(`agents:options:${spaceId}`, () => fetchJson(`/api/spaces/${spaceId}/agents/options`))
      .then((o) => {
        if (!live) return;
        setModels([
          ...o.models.filter((m) => m.ref && !m.problem).map((m) => ({ ref: m.ref!, label: m.label })),
          ...LOCAL_RUNTIMES.map((r) => ({ ref: `local/${r.id}`, label: r.label })),
        ]);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sharing, spaceId]);

  if (spaceLoading || loading) return <Skeleton className="h-40 w-full rounded-lg" />;
  if (error || !data) return <Alert>{error ?? 'Not found'}</Alert>;

  const { agent, runs, isAdmin, canManage } = data;
  const localRuntime = localRuntimeOf(agent.modelEffective);
  const localLabel = LOCAL_RUNTIMES.find((r) => r.id === localRuntime)?.label.replace(/^Your/, 'your') ?? 'your plan';
  const line = localRuntime
    ? { tone: 'muted' as const, text: `Runs on ${localLabel} from the desktop app`, problem: false }
    : statusLine(agent);
  const liveRun = runs.find((r) => r.status === 'running') ?? null;
  const blocker = agent.activation.active ? null : setupBlocker(agent, isAdmin);
  // A brief on a member's own plan runs from the desktop app when a person
  // presses Run — no activation, no schedule (lib/agents/local.ts).
  const desktop = localRuntime ? desktopRuntimes() : null;
  const runnable = localRuntime
    ? canManage && !agent.invalid && desktop !== null && localRun === null
    : canManage && agent.state.status !== 'running' && !agent.invalid;
  // What the run column shows: the run in flight, else the one the URL names,
  // else the latest. A live run always wins — watching it is why you are here.
  const shownRun = liveRun ?? runs.find((r) => r.id === runParam) ?? runs[0] ?? null;

  const patchActive = async (active: boolean) => {
    if (!spaceId) return;
    setBusy(true);
    try {
      await fetchJson(`/api/spaces/${spaceId}/agents/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active }),
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
    if (localRuntime) {
      setNotice(null);
      setLocalRun(Date.now());
      return;
    }
    setBusy(true);
    setNotice(null);
    // The run row exists before the executor starts, so the first reload puts
    // the live chain up while this request is still waiting on the outcome.
    // A run that outlasts the request answers `running`, with no outcome yet —
    // the standing 4 s poll above carries it from there.
    const t = setInterval(reload, 1500);
    try {
      const res = await fetchJson<{
        ok: true;
        runId: string;
        running: boolean;
        outcome: { status: string; reason: string } | null;
        error: string | null;
      }>(
        `/api/spaces/${spaceId}/agents/${encodeURIComponent(name)}/run`,
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

  // Who a run acted for, when it was not the agent's own identity.
  const nameOf = new Map(agent.subscribers.map((sub) => [sub.userId, sub.name]));
  const whoOf = (r: SerializedRun) => (r.runAsUserId && r.runAsUserId !== agent.readiness.runAsUserId ? (nameOf.get(r.runAsUserId) ?? null) : null);
  const others = agent.subscribers.filter((sub) => sub.userId !== agent.readiness.runAsUserId).length;
  const needs = { ...agent.readiness.needs, needs: agent.readiness.needs.needs.filter((n) => n.status !== 'no_model') };
  const statusText = [line.text, others > 0 ? `runs for ${others + 1}` : null].filter(Boolean).join(' · ');
  const iconButton =
    'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-16">
      <AgentTrail view={view} onView={go} onShare={() => setSharing(true)} />
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-tight text-text-primary">{agent.title || agent.name}</h1>
          {!localRuntime && (
            <Toggle
              checked={agent.activation.active}
              disabled={!canManage || busy || !!agent.invalid}
              aria-label={agent.activation.active ? 'Turn off' : 'Turn on'}
              onChange={(next) => (next ? setActivating(true) : patchActive(false))}
            />
          )}
          {canManage && (
            <button type="button" className={iconButton} disabled={!runnable || busy} onClick={runNow} aria-label="Run" title="Run">
              <PlayIcon className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          <StatusDot tone={line.tone} />
          {canManage && !localRuntime && !line.problem ? (
            <button type="button" className="min-w-0 truncate text-left text-[13px] text-text-secondary hover:text-text-primary" onClick={() => setActivating(true)}>
              {statusText}
            </button>
          ) : (
            <p className={`min-w-0 truncate text-[13px] ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-secondary'}`} title={line.text}>
              {statusText}
            </p>
          )}
        </div>
        {blocker && <p className="pl-[18px] text-[13px] text-amber-700">{blocker.text}</p>}
        <div className="pl-[18px] empty:hidden">
          <AgentNeeds needs={needs} isAdmin={isAdmin} onEditSettings={() => go('config')} />
          {agent.readiness.runAs && <ConnectorReadinessNotices items={agent.readiness.runAs} mine={false} who={agent.readiness.runAsName} isAdmin={isAdmin} />}
        </div>
        {notice && (
          <Alert inline variant="warning" className="ml-[18px]">
            {notice}
          </Alert>
        )}
        {agent.invalid && (
          <Alert inline className="ml-[18px]">
            {agent.invalid}
          </Alert>
        )}
        {agent.activation.invalid && (
          <Alert inline className="ml-[18px]">
            {agent.activation.invalid}
          </Alert>
        )}
      </header>

      {spaceId && view === 'config' && (
        <main className="min-w-0 border-t border-border-subtle pt-3">
          <AgentConfig
            spaceId={spaceId}
            agent={agent}
            isAdmin={isAdmin}
            canManage={canManage}
            liveRun={!!liveRun}
            onSchedule={() => setActivating(true)}
            onSaved={() => void reload()}
          />
        </main>
      )}

      {view === 'history' && (
        <main className="min-w-0 border-t border-border-subtle pt-5">
          <AgentHistory
            agentName={name}
            runs={runs}
            memory={agent.memory}
            shownRunId={shownRun?.id ?? null}
            whoOf={whoOf}
            onSelect={(id) => go('run', id === liveRun?.id ? null : id)}
          />
        </main>
      )}

      {view === 'run' && (localRun !== null || shownRun) && spaceId && (
        <main className="min-w-0 border-t border-border-subtle pt-5">
          {localRun !== null ? (
            <LocalRunPane
              key={localRun}
              spaceId={spaceId}
              agentName={name}
              onRecorded={(runId) => {
                setLocalRun(null);
                selectRun(runId);
                void reload();
              }}
              onFailed={(message) => {
                setLocalRun(null);
                setNotice(message);
                void reload();
              }}
            />
          ) : shownRun ? (
            <RunPane
              key={shownRun.id}
              spaceId={spaceId}
              agentName={name}
              runId={shownRun.id}
              who={whoOf(shownRun)}
              picker={
                <button type="button" className="shrink-0 rounded-md px-1.5 py-1 text-[12px] text-text-muted hover:bg-surface-2 hover:text-text-primary" onClick={() => go('history')}>
                  {fmtAgo(shownRun.startedAt)}
                </button>
              }
              onFinished={() => void reload()}
            />
          ) : null}
        </main>
      )}

      {sharing && spaceId && (
        <SharePanel
          spaceId={spaceId}
          path={agentBriefPath(name)}
          kind="note"
          title={agent.title || agent.name}
          onClose={() => setSharing(false)}
          extra={
            <RunsForSection
              spaceId={spaceId}
              agentName={name}
              people={agent.subscribers.filter((sub) => sub.userId !== agent.readiness.runAsUserId)}
              viewerId={session?.user.id ?? ''}
              viewerName={session?.user.name ?? 'You'}
              viewerImage={session?.user.image ?? null}
              viewerIsAuthor={agent.readiness.viewerIsRunAs}
              canManage={canManage}
              models={models}
              daily={agent.activation.schedule?.kind === 'daily' || agent.activation.schedule?.kind === 'weekly'}
              onChanged={() => void reload()}
            />
          }
        />
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
