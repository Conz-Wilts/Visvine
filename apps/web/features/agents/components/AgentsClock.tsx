'use client';

import Link from '@/features/shared/components/SpaceLink';
import { useMemo } from 'react';
import { clockEntries } from '@/lib/agents/shared/roster';
import StatusDot from './StatusDot';

import type { RosterResponse } from '../lib/useAgentsRoster';

const agentHref = (name: string) => `/directory/${encodeURIComponent(`agent:${name}`)}`;

/**
 * The clock over the Directory's Agents table: the next 24 hours across every
 * agent (and the nightly clean), what is running first. The table under it
 * is the shared DirectoryTable, one row per agent (features/agents/lib/agentRows.ts).
 *
 * The data is `useAgentsRoster`'s (polled by the view that mounts this);
 * this is the reading of it. Nothing is drawn when nothing is due.
 */
export default function AgentsClock({ data, now }: { data: RosterResponse | null; now: number }) {
  const clock = useMemo(
    () => (data ? clockEntries(data.agents.map((a) => ({ ...a, status: a.state.status, active: a.activation.active, nextRunAt: a.state.nextRunAt })), data.clean, now) : []),
    [data, now],
  );
  const byName = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.name, a])), [data]);
  if (clock.length === 0) return null;

  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col border-b border-line-subtle px-2 py-2">
      {clock.map((e) => {
        const agent = e.kind === 'clean' ? null : byName.get(e.name);
        const href = e.kind === 'clean' ? '/admin?section=general' : agentHref(e.name);
        return (
          <Link
            key={`${e.kind}:${e.name}`}
            href={href}
            className="group flex h-9 items-center gap-4 rounded px-2 text-[13px] hover:bg-surface-subtle"
          >
            <span className="w-12 shrink-0 font-mono text-[12px] tabular-nums text-fg-muted">{e.at ? time(e.at) : 'now'}</span>
            <StatusDot tone={e.kind === 'running' ? 'live' : 'muted'} />
            <span className="min-w-0 truncate font-medium text-fg">{e.title}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-muted">
              {e.kind === 'running'
                ? agent?.currentStep ?? 'running'
                : e.kind === 'clean'
                  ? 'nightly clean'
                  : agent
                    ? agent.activation.scheduleLabel.replace(/^No schedule$/, 'on triggers')
                    : ''}
            </span>
            {e.who && <span className="shrink-0 text-[12px] text-fg-muted">{e.who}</span>}
          </Link>
        );
      })}
    </div>
  );
}
