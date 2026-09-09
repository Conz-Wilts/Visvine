'use client';

import Link from 'next/link';
import { hrefForNotePath } from '@/lib/notes/entities';
import { useRun, type RunDetail } from '../lib/useRun';
import { fmtDuration, terminalLabel } from '../lib/rowState';
import { stepsOf } from '@/lib/agents/shared/trace';
import RunSteps, { type EndNode, type TriggerNode } from './RunSteps';
import StatusDot from './StatusDot';
import { useEffect, useState } from 'react';

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{children}</p>;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * One run, watched or read back — the page's wide column.
 *
 * A status line that breathes while it is on — how long, which turn, what it
 * is doing right now — over the chain of nodes it walked, with the machine's
 * record nested in the steps that drove it, then what it changed and how it
 * summed itself up. The same pane follows a run in flight and opens one from
 * the sidebar's history; `live` is just a fact about the run.
 */
export default function RunPane({
  spaceId,
  agentName,
  runId,
  maxTurns,
  onFinished,
  onEditBrief,
}: {
  spaceId: string;
  agentName: string;
  runId: string;
  maxTurns: number | null;
  onFinished?: (run: RunDetail) => void;
  /** Offered after a run, for anyone who may: the run is where you learn what the brief should have said. */
  onEditBrief?: () => void;
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

  const outcome = !run
    ? null
    : run.status === 'failed'
      ? `Failed — ${terminalLabel(run.terminalReason) || 'error'}`
      : run.terminalReason && run.terminalReason !== 'finished'
        ? `Finished — ${terminalLabel(run.terminalReason)}`
        : 'Finished';

  // The chain's first and last nodes: what woke the run, and how it ended.
  const triggerEvents = run?.input?.events ?? null;
  const trigger: TriggerNode | null = run
    ? {
        kind: run.trigger,
        label:
          // A run someone started by saying something reads as the ask, not
          // as mail it happened to find.
          run.trigger === 'manual' && triggerEvents?.length && triggerEvents.every((e) => e.kind === 'reply')
            ? 'Asked'
            : triggerEvents?.length
              ? `Woken by ${triggerEvents.length} event${triggerEvents.length === 1 ? '' : 's'}${run.eventCount > triggerEvents.length ? ` · ${run.eventCount} consumed` : ''}`
              : ({ scheduled: 'On schedule', interval: 'On its interval', manual: 'Run by hand', webhook: 'Woken by a webhook' } as Record<string, string>)[run.trigger] ?? run.trigger,
        events: triggerEvents,
      }
    : null;
  const end: EndNode | null = run && !running && outcome ? { tone: run.status === 'failed' ? 'bad' : 'ok', label: outcome } : null;

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
          outcome,
          fmtDuration(run.startedAt, run.endedAt),
          `${run.turns} turn${run.turns === 1 ? '' : 's'}`,
          toolCalls ? `${toolCalls} step${toolCalls === 1 ? '' : 's'}` : null,
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

      <div>
        {run?.transcriptHidden ? (
          <p className="text-[13px] text-text-muted">The steps are visible to the agent&apos;s author and admins only.</p>
        ) : (
          <RunSteps
            events={run?.events ?? []}
            machine={run?.machine?.events ?? null}
            live={running}
            startedAt={startedAt}
            trigger={trigger}
            end={end}
            scroll={running}
          />
        )}
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

      {run && !running && onEditBrief && (
        <p className="text-[12px] text-text-muted">
          Not what you wanted?{' '}
          <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={onEditBrief}>
            Adjust the brief
          </button>
        </p>
      )}
    </div>
  );
}
