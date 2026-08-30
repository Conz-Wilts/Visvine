'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentRunEvent } from '@/lib/agents/runs';
import type { SerializedRun } from '@/lib/agents/service';
import { stepsOf } from './RunSteps';
import RunSteps from './RunSteps';
import StatusDot from './StatusDot';
import { terminalLabel } from '../lib/rowState';

type RunWithEvents = SerializedRun & { events: AgentRunEvent[]; transcriptHidden: boolean };

/**
 * The run that is happening now, at the top of the agent's page: a breathing
 * status line — how long it has been going, which turn it is on, what it has
 * touched — over the step timeline, refreshed every two seconds. The executor
 * flushes the trace that often (lib/agents/limits.ts#FLUSH_EVERY_MS), and
 * polling is correct across many instances where a stream would not be.
 *
 * When the run ends the panel says how and hands back to the page, which
 * reloads so the history row appears in its place; the same transcript is then
 * reachable there, so nothing shown here is lost.
 */
export default function LiveRun({
  spaceId,
  agentName,
  runId,
  maxTurns,
  onFinished,
}: {
  spaceId: string;
  agentName: string;
  runId: string;
  maxTurns: number | null;
  onFinished: (run: RunWithEvents) => void;
}) {
  const [run, setRun] = useState<RunWithEvents | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const data = await fetchJson<{ run: RunWithEvents }>(
          `/api/communities/${spaceId}/agents/${encodeURIComponent(agentName)}/runs/${runId}`,
        );
        if (cancelled) return;
        setRun(data.run);
        setError(null);
        if (data.run.status === 'running') timer = setTimeout(load, 2000);
        else onFinished(data.run);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not follow the run');
        timer = setTimeout(load, 4000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, agentName, runId, onFinished]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const startedAt = run ? new Date(run.startedAt).getTime() : now;
  const elapsed = Math.max(0, Math.round(((run?.endedAt ? new Date(run.endedAt).getTime() : now) - startedAt) / 1000));
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const steps = run ? stepsOf(run.events) : [];
  const toolCalls = steps.filter((s) => s.kind === 'tool').length;
  const writes = new Set(
    steps
      .filter((s) => s.kind === 'tool' && (s.tool === 'write_context' || s.tool === 'append_context') && s.result && !/^error/i.test(s.result))
      .map((s) => s.detail),
  ).size;
  const current = [...steps].reverse().find((s) => s.kind === 'tool' && s.result === undefined);
  const running = !run || run.status === 'running';

  const line = !run
    ? 'Starting…'
    : running
      ? [
          `Running · ${clock}`,
          `turn ${run.turns}${maxTurns ? ` of ${maxTurns}` : ''}`,
          toolCalls ? `${toolCalls} step${toolCalls === 1 ? '' : 's'}` : null,
          writes ? `${writes} note${writes === 1 ? '' : 's'} written` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : `${run.status === 'failed' ? 'Failed' : 'Finished'} · ${terminalLabel(run.terminalReason) || run.status} · ${clock}`;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-sky-200 bg-sky-50/40 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex items-center gap-3">
        <StatusDot tone={running ? 'live' : run?.status === 'failed' ? 'bad' : 'ok'} />
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">{line}</p>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-muted">{run?.trigger ?? ''}</span>
      </div>
      {current?.detail && running && (
        <p className="truncate pl-5 font-mono text-[12px] text-text-secondary" title={current.detail}>
          now: {current.tool} {current.detail}
        </p>
      )}
      {error && <p className="pl-5 text-[12px] text-amber-700">{error} — retrying</p>}
      {run?.transcriptHidden ? (
        <p className="pl-5 text-[13px] text-text-muted">The steps are visible to the agent&apos;s author and admins only.</p>
      ) : (
        <div className="pl-5">
          <RunSteps events={run?.events ?? []} live={running} startedAt={startedAt} />
        </div>
      )}
    </section>
  );
}
