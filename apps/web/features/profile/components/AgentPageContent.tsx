'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PlayIcon } from '@/features/shared/icons';
import { Alert, Modal, Skeleton } from '@/components/ui';
import Toggle from '@/components/ui/Toggle';
import { useSpace } from '@/features/shared/contexts/SpaceContext';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentReadiness, AgentSubscriber, AgentSummary, SerializedRun } from '@/lib/agents/service';
import ActivateAgentDialog from '@/features/agents/components/ActivateAgentDialog';
import AgentSettingsDialog from '@/features/agents/components/AgentSettingsDialog';
import AgentSidebar from '@/features/agents/components/AgentSidebar';
import MachinePane from '@/features/agents/components/MachinePane';
import MessageAgent from '@/features/agents/components/MessageAgent';
import RunPane from '@/features/agents/components/RunPane';
import SkillsPanel from '@/features/agents/components/SkillsPanel';
import StatusDot from '@/features/agents/components/StatusDot';
import { setupBlocker, statusLine, terminalLabel } from '@/features/agents/lib/rowState';

/**
 * The first tab of an agent's node page: what the note alone can't say.
 *
 * Two columns and one subject. The wide one is THE RUN — the chain of nodes
 * the agent walked, live or read back — because that is what a person opens
 * this page to see. The narrow one is the agent as a thing: when it fires, who
 * it fires for, what to say to it, what it did before. Everything you
 * configure rather than watch — model, tools, connectors, the monthly cap, the
 * skills it has been taught, the machine's own screen — is behind a button on
 * that column, so the page stays the run.
 *
 * The brief itself is the note, on the Context and Raw tabs beside this one.
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

type Panel = 'settings' | 'skills' | 'machine';

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
  const [panel, setPanel] = useState<Panel | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
  const line = statusLine(agent);
  const liveRun = runs.find((r) => r.status === 'running') ?? null;
  const blocker = agent.activation.active ? null : setupBlocker(agent, isAdmin);
  const runnable = canManage && agent.activation.active && agent.state.status !== 'running' && !agent.invalid;
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
      {/* One line for the whole agent: how it is, and the two controls that
          change that. Everything else is a column below. */}
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <StatusDot tone={line.tone} />
          <p
            className={`min-w-0 flex-1 truncate text-sm ${line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-primary'}`}
          >
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
            onChange={(next) => (next ? setActivating(true) : patchActive(false))}
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
      </header>

      <div className="grid gap-8 border-t border-border-subtle pt-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <main className="min-w-0">
          {shownRun && spaceId ? (
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
          onOpen={setPanel}
          onEditBrief={editBrief}
        >
          {spaceId && agent.activation.active ? <MessageAgent spaceId={spaceId} agentName={name} /> : null}
        </AgentSidebar>
      </div>

      {panel === 'settings' && spaceId && canManage && (
        <AgentSettingsDialog
          spaceId={spaceId}
          agent={agent}
          isAdmin={isAdmin}
          onClose={() => setPanel(null)}
          onSaved={() => void reload()}
          onEditBrief={() => {
            setPanel(null);
            editBrief();
          }}
        />
      )}

      {panel === 'skills' && spaceId && (
        <Modal onClose={() => setPanel(null)} title="Skills" size="md">
          <SkillsPanel spaceId={spaceId} agentName={name} isAdmin={isAdmin} />
        </Modal>
      )}

      {/* The machine's live screen and terminal. Admins only — a terminal is
          not a member's surface — and a dialog rather than a third column,
          because the stored record of what it did is already nested under the
          run's own steps. */}
      {panel === 'machine' && spaceId && isAdmin && (
        <Modal onClose={() => setPanel(null)} title="Machine" size="lg">
          <MachinePane spaceId={spaceId} agentName={name} autoWatch={!!liveRun} />
        </Modal>
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
