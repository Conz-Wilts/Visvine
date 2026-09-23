'use client';

import Link from '@/features/shared/components/SpaceLink';
import { hrefForNotePath } from '@/lib/notes/entities';
import { memoryPath, memorySections } from '@/lib/agents/shared/memory';
import type { SerializedRun } from '@/lib/agents/service';
import { fmtAgo, fmtDuration, terminalLabel } from '../lib/rowState';
import StatusDot from './StatusDot';

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between pb-1">
      <h2 className="text-[13px] font-semibold text-fg">{children}</h2>
      {action}
    </div>
  );
}

/**
 * What the agent has done and what it took away from it: its runs, newest
 * first — a row opens that run — and under them the memory it carries from
 * one to the next. The memory is a note; this reads it, the note is where a
 * person corrects it.
 */
export default function AgentHistory({
  agentName,
  runs,
  memory,
  shownRunId,
  whoOf,
  onSelect,
}: {
  agentName: string;
  runs: SerializedRun[];
  memory: string | null;
  shownRunId: string | null;
  whoOf: (run: SerializedRun) => string | null;
  onSelect: (runId: string) => void;
}) {
  const sections = memorySections(memory);

  return (
    <div className="flex flex-col gap-8">
      {runs.length > 0 && (
        <section>
          <Heading>Runs</Heading>
          <ul className="flex flex-col">
            {runs.map((r) => {
              const who = whoOf(r);
              return (
                <li key={r.id} className="border-b border-line-subtle">
                  <button
                    type="button"
                    aria-current={r.id === shownRunId ? 'true' : undefined}
                    className="flex h-11 w-full items-center gap-3 px-1 text-left hover:bg-surface-subtle"
                    onClick={() => onSelect(r.id)}
                  >
                    <StatusDot tone={r.status === 'running' ? 'live' : r.status === 'failed' ? 'bad' : 'ok'} />
                    <span className="w-24 shrink-0 text-[13.5px] text-fg">{fmtAgo(r.startedAt)}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">
                      {r.status === 'failed' ? <span className="text-danger">{terminalLabel(r.terminalReason) || 'failed'}</span> : r.summary}
                    </span>
                    {who && <span className="shrink-0 text-[12px] text-fg-muted">{who}</span>}
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-fg-muted">
                      {r.status === 'running' ? 'now' : fmtDuration(r.startedAt, r.endedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sections.length > 0 && (
        <section>
          <Heading
            action={
              <Link href={hrefForNotePath(memoryPath(agentName), null)} className="text-[12px] text-fg-muted hover:text-fg">
                Open note
              </Link>
            }
          >
            Memory
          </Heading>
          <div className="flex flex-col">
            {sections.map((s) => (
              <div key={s.section} className="flex gap-4 border-b border-line-subtle py-2.5">
                <span className="w-28 shrink-0 text-[13px] text-fg-muted">{s.section}</span>
                <ul className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-fg">
                  {s.lines.map((line) => (
                    <li key={line} className="break-words">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {runs.length === 0 && sections.length === 0 && <p className="text-[13px] text-fg-muted">No runs yet.</p>}
    </div>
  );
}
