'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/fetchJson';
import { hrefForNotePath } from '@/lib/notes/entities';
import type { AgentRunEvent } from '@/lib/agents/runs';
import type { SerializedRun } from '@/lib/agents/service';
import { fmtCents, terminalLabel } from '../lib/rowState';
import RunSteps from './RunSteps';

type RunWithEvents = SerializedRun & { events: AgentRunEvent[]; transcriptHidden: boolean };

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</p>;
}

/**
 * One run from the history, opened: what it was handed, the steps it took
 * (RunSteps), what it changed and how it summed itself up. Polls every 3 s
 * while the run is still `running` — a row opened mid-run keeps moving — but
 * the live panel at the top of the page is where a run in flight is watched.
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

  const startedAt = new Date(run.startedAt).getTime();
  const seconds = run.endedAt ? Math.round((new Date(run.endedAt).getTime() - startedAt) / 1000) : null;
  const meta = [
    run.status === 'running' ? 'Running…' : terminalLabel(run.terminalReason) || run.status,
    run.input?.dryRun ? 'dry run' : null,
    run.input?.chain ? `chained · depth ${run.input.chain.depth}` : null,
    seconds !== null ? `${seconds}s` : null,
    `${run.turns} turn${run.turns === 1 ? '' : 's'}`,
    `${run.promptTokens.toLocaleString()} in · ${run.completionTokens.toLocaleString()} out`,
    run.costCents === null ? null : fmtCents(run.costCents),
    run.model,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4 pl-5">
      <p className="text-[12px] text-text-muted">{meta.join('  ·  ')}</p>
      {run.errorMessage && <p className="border-l-2 border-red-500 pl-3 text-[13px] text-red-700">{run.errorMessage}</p>}
      {run.input?.events?.length ? (
        <div>
          <Caption>
            {run.input.events.length} event{run.input.events.length === 1 ? '' : 's'}
            {run.eventCount > run.input.events.length ? ` · ${run.eventCount} consumed` : ''}
          </Caption>
          <ol className="mt-1 flex flex-col gap-0.5 font-mono text-[12px]">
            {run.input.events.map((e, i) => (
              <li key={i} className="break-words">
                <span className="text-sky-700">{e.kind}</span> {e.source} <span className="text-text-muted">— {e.summary}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <div>
        <Caption>Steps</Caption>
        <div className="mt-2">
          {run.transcriptHidden ? (
            <p className="text-[13px] text-text-muted">Visible to the author and admins only.</p>
          ) : (
            <RunSteps events={run.events} live={run.status === 'running'} startedAt={startedAt} emptyText="Nothing yet." />
          )}
        </div>
      </div>
      {run.input?.writes?.length ? (
        <div>
          <Caption>
            {run.input.dryRun ? 'Would change' : 'Changed'} · {run.input.writes.length}
          </Caption>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[12px]">
            {run.input.writes.map((path) => (
              <li key={path} className="break-words">
                <Link className="hover:text-brand-dark-green hover:underline" href={hrefForNotePath(path, null)}>
                  {path}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.summary && (
        <div>
          <Caption>Summary</Caption>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{run.summary}</p>
        </div>
      )}
    </div>
  );
}
