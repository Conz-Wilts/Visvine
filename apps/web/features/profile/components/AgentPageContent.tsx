'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PlayIcon, SettingsIcon } from '@/features/shared/icons';
import { Alert, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentReadiness, AgentSubscriber, AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import AgentSettingsDialog, { type SettingsTab } from '@/features/agents/components/AgentSettingsDialog';
import AgentSetupBar from '@/features/agents/components/AgentSetupBar';
import AgentSidebar from '@/features/agents/components/AgentSidebar';
import MessageAgent from '@/features/agents/components/MessageAgent';
import RunPane from '@/features/agents/components/RunPane';
import StatusDot from '@/features/agents/components/StatusDot';
import LocalRunPane from '@/features/agents/components/LocalRunPane';
import { setupBlocker, statusLine, terminalLabel } from '@/features/agents/lib/rowState';
import { desktopRuntimes } from '@/features/desktop/lib/desktop';
import { LOCAL_RUNTIMES, localRuntimeOf } from '@/lib/agents/local';

/**
 * The first tab of an agent's node page: what the note alone can't say.
 *
 * A header and two columns, one subject. The header is the agent in a
 * glance: its name and what it does on the left, what it runs on and reaches
 * on the right as marks, and under them one line for how it is with the
 * switch and Run beside it. The wide column is THE RUN — the steps the agent
 * walked, live or read back — because that is what a person opens this page
 * to see. The narrow one is when it fires, who it fires for, and what it did
 * before. Everything you configure or look into rather than watch — model,
 * tools, connectors, the cap, memory, skills, the machine's own screen — is
 * behind the gear in the header, so the page stays the run.
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
  const [panel, setPanel] = useState<SettingsTab | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // A run on the member's own plan, in flight on this machine — keyed by the
  // press that started it, so each Run is its own pane.
  const [localRun, setLocalRun] = useState<number | null>(null);

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
    : canManage && agent.activation.active && agent.state.status !== 'running' && !agent.invalid;
  // What the run column shows: the run in flight, else the one the URL names,
  // else the latest. A live run always wins — watching it is why you are here.
  const shownRun = liveRun ?? runs.find((r) => r.id === runParam) ?? runs[0] ?? null;
  const maxTurns = /^max_turns:\s*(\d+)/m.exec(agent.brief)?.[1];
  const editBrief = () => router.replace(`/directory/${encodeURIComponent(nodeId)}?tab=context`);

  const patchActive = async (active: boolean) => {
    if (!spaceId) return;
    setBusy(true);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}`, {
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

  const subscribe = async (subscribed: boolean, userId?: string) => {
    if (!spaceId) return;
    setBusy(true);
    setNotice(null);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(name)}/subscribers`, {
        method: subscribed ? 'POST' : 'DELETE',
        ...(userId ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) } : {}),
      });
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not update who it runs for');
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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-16">
      {/* The agent in a glance: name and purpose on the left, what it runs on
          and reaches on the right, then one line for how it is with the two
          controls that change that. */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold leading-tight text-text-primary">{agent.title || agent.name}</h1>
            {agent.description && <p className="mt-1 text-[13px] text-text-muted">{agent.description}</p>}
          </div>
          <div className="flex items-center gap-2">
            <AgentSetupBar agent={agent} />
            <button
              type="button"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border-subtle bg-surface-1 text-text-muted hover:bg-surface-2 hover:text-text-primary"
              aria-label="Settings"
              title="Settings"
              onClick={() => setPanel(canManage ? 'settings' : 'memory')}
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot tone={line.tone} />
          <p
            className={`min-w-0 flex-1 truncate text-[13px] ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-secondary'}`}
          >
            {line.text}
          </p>
          {!localRuntime && <Toggle
            checked={agent.activation.active}
            disabled={!canManage || busy || !!agent.invalid}
            aria-label={canManage ? (agent.activation.active ? 'Turn off' : 'Turn on') : 'Someone who can edit the brief turns it on'}
            onChange={(next) => (next ? setActivating(true) : patchActive(false))}
          />}
          {canManage && (
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-semibold text-text-secondary hover:bg-surface-2 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!runnable || busy}
              onClick={runNow}
              title={localRuntime ? (desktop ? 'Run on your plan, from this machine' : 'Runs from the desktop app') : agent.activation.active ? 'Run now' : 'Turn it on first'}
            >
              <PlayIcon className="h-3 w-3" /> Run
            </button>
          )}
        </div>
        {localRuntime && (
          <p className="pl-5 text-[13px] text-text-muted">
            Runs on {localLabel}, from this machine, when you press Run. Usage counts against that plan, not the space’s key.
            {!desktop && ' Open Visvine in the desktop app to run it.'}
          </p>
        )}
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
      </header>

      <div className="grid gap-8 border-t border-border-subtle pt-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <main className="min-w-0">
          {localRun !== null && spaceId ? (
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
          ) : shownRun && spaceId ? (
            <RunPane
              key={shownRun.id}
              spaceId={spaceId}
              agentName={name}
              runId={shownRun.id}
              maxTurns={maxTurns ? Number(maxTurns) : null}
              onFinished={() => void reload()}
              onEditBrief={canManage ? editBrief : undefined}
            />
          ) : (
            <p className="text-[13px] text-text-muted">
              No runs yet.{' '}
              {runnable
                ? 'Press Run, or ask it something below.'
                : localRuntime
                  ? 'Its runs appear here.'
                  : agent.activation.active
                  ? 'The first one appears here when it fires.'
                  : 'Turn it on and its runs appear here.'}
            </p>
          )}

          {/* The inline door. Under the line, because what you say starts a
              run that appears right above it — and its answer is the run's
              summary. Not for a brief on a member's own plan: that runs
              from the desktop app. */}
          {spaceId && !localRuntime && canManage && (
            <div className="mt-6">
              <MessageAgent
                spaceId={spaceId}
                agentName={name}
                disabled={!agent.activation.active || !!agent.invalid}
                onStarted={selectRun}
                onSettled={() => void reload()}
              />
            </div>
          )}
        </main>

        <AgentSidebar
          agent={agent}
          runs={runs}
          shownRunId={shownRun?.id ?? null}
          isAdmin={isAdmin}
          canManage={canManage}
          busy={busy}
          blocker={blocker}
          onSelectRun={(id) => selectRun(id === liveRun?.id ? null : id)}
          onSchedule={() => setActivating(true)}
          onSubscribe={subscribe}
          onOpenSettings={() => setPanel('settings')}
          onEditBrief={editBrief}
        />
      </div>

      {panel && spaceId && (
        <AgentSettingsDialog
          spaceId={spaceId}
          agent={agent}
          isAdmin={isAdmin}
          canManage={canManage}
          liveRun={!!liveRun}
          initialTab={panel}
          onClose={() => setPanel(null)}
          onSaved={() => void reload()}
          onEditBrief={() => {
            setPanel(null);
            editBrief();
          }}
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
