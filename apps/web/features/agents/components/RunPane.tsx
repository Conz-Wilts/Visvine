'use client';

import Link from '@/features/shared/components/SpaceLink';
import { hrefForNotePath } from '@/lib/notes/entities';
import { useRun, type RunDetail } from '../lib/useRun';
import { fmtDuration, terminalLabel } from '../lib/rowState';
import RunSteps from './RunSteps';
import StatusDot from './StatusDot';
import { useEffect, useState } from 'react';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';

function Caption({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{children}</p>;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * One run, watched or read back.
 *
 * One line for how it went — and, at its end, which run this is — over the
 * steps it walked, then what it changed. The same pane follows a run in flight
 * and opens an older one; `live` is just a fact about the run.
 */
export default function RunPane({
  spaceId,
  agentName,
  runId,
  who,
  picker,
  onFinished,
}: {
  spaceId: string;
  agentName: string;
  runId: string;
  /** The person this run acted for, when that is worth saying. */
  who?: string | null;
  /** Sits at the end of the run line: which run this is, and the way to another. */
  picker?: React.ReactNode;
  onFinished?: (run: RunDetail) => void;
}) {
  const { run, error } = useRun(spaceId, agentName, runId, onFinished);
  const [now, setNow] = useState(() => Date.now());
  const running = !run || run.status === 'running';
  const visible = usePageVisible();
  useEffect(() => {
    if (!running || !visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, visible]);

  const startedAt = run ? new Date(run.startedAt).getTime() : now;
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const writes = run?.input?.writes?.length ?? 0;
  const outcome = !run
    ? 'Starting…'
    : running
      ? `Running · ${clock(elapsed)}`
      : run.status === 'failed'
        ? `Failed — ${terminalLabel(run.terminalReason) || 'error'}`
        : run.terminalReason && run.terminalReason !== 'finished'
          ? `Finished — ${terminalLabel(run.terminalReason)}`
          : 'Finished';
  const line = [outcome, run && !running ? fmtDuration(run.startedAt, run.endedAt) : null, who, run?.input?.dryRun ? 'dry run' : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <StatusDot tone={running ? 'live' : run?.status === 'failed' ? 'bad' : 'ok'} />
        <p className={`min-w-0 flex-1 truncate text-[13px] font-medium ${run?.status === 'failed' ? 'text-danger' : 'text-fg'}`}>{line}</p>
        {picker}
      </div>
      {error && <p className="pl-5 text-[12px] text-warning">{error} — retrying</p>}
      {run?.errorMessage && <p className="border-l-2 border-danger-bright pl-3 text-[13px] text-danger-strong">{run.errorMessage}</p>}

      {run?.transcriptHidden ? (
        <p className="text-[13px] text-fg-muted">The steps are visible to the agent&apos;s author and admins only.</p>
      ) : (
        <RunSteps events={run?.events ?? []} machine={run?.machine?.events ?? null} live={running} />
      )}

      {run?.machine?.refusals.length ? (
        <div>
          <Caption>Refused · {run.machine.refusals.length}</Caption>
          <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[12px] text-danger-strong">
            {run.machine.refusals.map((r) => (
              <li key={r.id} className="break-words">
                {r.method} {r.host}
                {r.path && r.path !== '/' ? r.path : ''}
                {r.reason ? <span className="text-fg-muted"> — {r.reason}</span> : null}
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
                <Link className="hover:text-accent-strong hover:underline" href={hrefForNotePath(path, null)}>
                  {path}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
