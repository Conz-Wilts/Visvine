'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentRunEvent } from '@/lib/agents/runs';
import type { SerializedRun } from '@/lib/agents/service';
import { fmtCents, terminalLabel } from '../lib/rowState';

type RunWithEvents = SerializedRun & { events: AgentRunEvent[] };

/**
 * One run's transcript. Polls every 3 s while the run is `running` — the
 * executor flushes the trace often, and polling is correct across many
 * instances where an in-process stream would not be. Never lives in a note.
 */
export default function RunTranscript({ spaceId, agentName, runId }: { spaceId: string; agentName: string; runId: string }) {
  const [run, setRun] = useState<RunWithEvents | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        if (data.run.status === 'running') timer = setTimeout(load, 3000);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the run');
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [spaceId, agentName, runId]);

  if (error) return <p className="text-[13px] text-red-700">{error}</p>;
  if (!run) return <p className="text-[13px] text-text-muted">Loading…</p>;

  const seconds = run.endedAt ? Math.round((new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()) / 1000) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-muted">
        <span className={run.status === 'running' ? 'text-sky-700' : run.status === 'failed' ? 'text-red-700' : 'text-brand-dark-green'}>
          {run.status === 'running' ? 'Running…' : `${run.status} — ${terminalLabel(run.terminalReason)}`}
        </span>
        <span>{run.trigger}</span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
        {seconds !== null && <span>{seconds}s</span>}
        <span>{run.turns} turn{run.turns === 1 ? '' : 's'}</span>
        <span>
          {run.promptTokens.toLocaleString()} in / {run.completionTokens.toLocaleString()} out
        </span>
        <span>{run.costCents === null ? 'cost n/a' : fmtCents(run.costCents)}</span>
        {run.model && <span className="font-mono">{run.model}</span>}
      </div>
      {run.errorMessage && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{run.errorMessage}</p>}
      <ol className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-2 p-3 font-mono text-[12px] leading-relaxed">
        {run.events.length === 0 && <li className="text-text-muted">No events yet.</li>}
        {run.events.map((e, i) => (
          <li key={i} className="whitespace-pre-wrap break-words">
            {e.type === 'assistant' && (
              <>
                <span className="text-brand-dark-green">assistant ›</span> {e.text}
              </>
            )}
            {e.type === 'tool' && (
              <>
                <span className="text-sky-700">{e.tool}</span> <span className="text-text-muted">{e.detail}</span>
              </>
            )}
            {e.type === 'tool_result' && <span className="text-text-muted">{e.text}</span>}
            {e.type === 'system' && <span className="text-amber-700">{e.text}</span>}
          </li>
        ))}
      </ol>
      {run.summary && (
        <div className="rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-[13px]">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Summary</p>
          <p className="mt-1 whitespace-pre-wrap">{run.summary}</p>
        </div>
      )}
    </div>
  );
}
