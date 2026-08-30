'use client';

import Link from 'next/link';
import { hrefForNotePath } from '@/lib/notes/entities';
import { useRun, type RunDetail } from '../lib/useRun';
import { fmtCents, fmtDuration, terminalLabel } from '../lib/rowState';
import { stepsOf } from '@/lib/agents/shared/trace';
import RunSteps from './RunSteps';
import StatusDot from './StatusDot';
import { useEffect, useState } from 'react';

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</p>;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * One run, watched or read back: a status line that breathes while it is on
 * — how long, which turn, what it has touched, what it is doing right now —
 * over the steps with the machine's record nested in them, then what it was
 * handed, what it changed and how it summed itself up. The same pane follows
 * a run in flight and opens one from the history; `live` is just a fact about
 * the run.
 */
export default function RunPane({
  spaceId,
  agentName,
  runId,
  maxTurns,
  isAdmin,
  onFinished,
}: {
  spaceId: string;
  agentName: string;
  runId: string;
  maxTurns: number | null;
  isAdmin: boolean;
  onFinished?: (run: RunDetail) => void;
}) {
  const { run, error } = useRun(spaceId, agentName, runId, onFinished);
  const [now, setNow] = useState(() => Date.now());
  const running = !run || run.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const startedAt = run ? new Date(run.startedAt).getTime() : now;
  const elapsed = Math.max(0, Math.round(((run?.endedAt ? new Date(run.endedAt).getTime() : now) - startedAt) / 1000));
  const steps = run ? stepsOf(run.events) : [];
  const toolCalls = steps.filter((s) => s.kind === 'tool').length;
  const current = [...steps].reverse().find((s) => s.kind === 'tool' && s.result === undefined);
  const writes = run?.input?.writes?.length ?? 0;

  const line = !run
    ? 'Starting…'
    : running
      ? [
          `Running · ${clock(elapsed)}`,
          `turn ${run.turns}${maxTurns ? ` of ${maxTurns}` : ''}`,
          toolCalls ? `${toolCalls} step${toolCalls === 1 ? '' : 's'}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : [
          run.status === 'failed'
            ? `Failed — ${terminalLabel(run.terminalReason) || 'error'}`
            : run.terminalReason && run.terminalReason !== 'finished'
              ? `Finished — ${terminalLabel(run.terminalReason)}`
              : 'Finished',
          fmtDuration(run.startedAt, run.endedAt),
          `${run.turns} turn${run.turns === 1 ? '' : 's'}`,
          toolCalls ? `${toolCalls} step${toolCalls === 1 ? '' : 's'}` : null,
          isAdmin && run.costCents !== null ? fmtCents(run.costCents) : null,
        ]
          .filter(Boolean)
          .join(' · ');

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <StatusDot tone={running ? 'live' : run?.status === 'failed' ? 'bad' : 'ok'} />
          <p className={`min-w-0 flex-1 truncate text-[13px] font-medium ${run?.status === 'failed' ? 'text-red-600' : 'text-text-primary'}`}>{line}</p>
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-text-muted">
            {run?.trigger ?? ''}
            {run?.input?.dryRun ? ' · dry run' : ''}
          </span>
        </div>
        {current?.detail && running && (
          <p className="truncate pl-5 font-mono text-[12px] text-text-secondary" title={current.detail}>
            now: {current.tool} {current.detail}
          </p>
        )}
        {run && !running && (
          <p className="pl-5 font-mono text-[11px] text-text-muted">
            {[run.model, `${run.promptTokens.toLocaleString()} in · ${run.completionTokens.toLocaleString()} out`, run.input?.chain ? `chained · depth ${run.input.chain.depth}` : null]
              .filter(Boolean)
              .join('  ·  ')}
          </p>
        )}
        {error && <p className="pl-5 text-[12px] text-amber-700">{error} — retrying</p>}
      </div>

      {run?.errorMessage && <p className="border-l-2 border-red-500 pl-3 text-[13px] text-red-700">{run.errorMessage}</p>}

      {run?.input?.events?.length ? (
        <div>
          <Caption>
            Triggered by {run.input.events.length} event{run.input.events.length === 1 ? '' : 's'}
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
          {run?.transcriptHidden ? (
            <p className="text-[13px] text-text-muted">The steps are visible to the agent&apos;s author and admins only.</p>
          ) : (
            <RunSteps events={run?.events ?? []} machine={run?.machine?.events ?? null} live={running} startedAt={startedAt} scroll={running} />
          )}
        </div>
      </div>

      {run?.machine?.refusals.length ? (
        <div>
          <Caption>Refused at the boundary · {run.machine.refusals.length}</Caption>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[12px] text-red-700">
            {run.machine.refusals.map((r) => (
              <li key={r.id} className="break-words">
                {r.method} {r.host}
                {r.path && r.path !== '/' ? r.path : ''}
                {r.reason ? <span className="text-text-muted"> — {r.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {writes > 0 && run?.input?.writes ? (
        <div>
          <Caption>
            {run.input.dryRun ? 'Would change' : 'Changed'} · {writes}
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

      {run?.summary && (
        <div>
          <Caption>Summary</Caption>
          <p className="mt-1 whitespace-pre-wrap text-[13px]">{run.summary}</p>
        </div>
      )}
    </div>
  );
}
