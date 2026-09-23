'use client';

import Link from '@/features/shared/components/SpaceLink';
import { useMemo } from 'react';
import { Alert, Skeleton } from '@/components/ui';
import { clockEntries, groupAgents, whoLabel } from '@/lib/agents/shared/roster';
import StatusDot from './StatusDot';
import { fmtAgo, fmtUntil, statusLine, terminalLabel } from '../lib/rowState';

import type { RosterResponse } from '../lib/useAgentsRoster';

const agentHref = (name: string) => `/directory/${encodeURIComponent(`agent:${name}`)}`;

/**
 * The Directory's Agents table: the roster, with the clock over it.
 *
 * Two questions a person has about agents — what runs here, and what happens
 * next — answered in one column. The strip on top is the next 24 hours across
 * every agent (and the nightly clean), what is running first; the list under
 * it is every agent filed under its group (the brief's first tag), one row
 * each: the dot, the name, what it is doing or when it fires, who it runs
 * for, and its last run. A running row shows its current step, so the glance
 * needs no click; the click goes to the agent's page, where the run is.
 *
 * The data is `useAgentsRoster`'s (polled by the view that mounts this);
 * this is the reading of it.
 */
export default function AgentsRoster({
  data,
  error,
  now,
  search,
  tags,
  onNavigate,
}: {
  data: RosterResponse | null;
  error: string | null;
  now: number;
  /** The toolbar's search, applied to names, titles and groups. */
  search: string;
  /** The toolbar's tag filter — an agent must carry every one. */
  tags: Set<string>;
  onNavigate: (href: string) => void;
}) {
  const agents = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.agents.filter((a) => {
      for (const want of tags) if (!a.tags.some((t) => t.toLowerCase() === want.toLowerCase())) return false;
      if (!q) return true;
      return [a.name, a.title, a.description ?? '', ...a.tags].some((s) => s.toLowerCase().includes(q));
    });
  }, [data, search, tags]);

  const groups = useMemo(() => groupAgents(agents.map((a) => ({ ...a, status: a.state.status, active: a.activation.active, nextRunAt: a.state.nextRunAt }))), [agents]);
  const clock = useMemo(
    () => (data ? clockEntries(data.agents.map((a) => ({ ...a, status: a.state.status, active: a.activation.active, nextRunAt: a.state.nextRunAt })), data.clean, now) : []),
    [data, now],
  );
  const byName = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.name, a])), [data]);

  if (error && !data) return <Alert>{error}</Alert>;
  if (!data) {
    return (
      <div className="flex flex-col divide-y divide-border-subtle pr-6">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-12 items-center gap-4">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        ))}
      </div>
    );
  }

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const isToday = (iso: string) => new Date(iso).toDateString() === new Date(now).toDateString();

  return (
    <div className="h-full w-full overflow-y-auto custom-scrollbar pr-6 pt-2">
      {/* The clock. A row is a time and what happens then; "now" is anything
          running. Nothing here that is not inside 24 hours. */}
      {clock.length > 0 && (
        <div className="mb-6 flex flex-col border-b border-border-subtle pb-4">
          {clock.map((e) => {
            const agent = e.kind === 'clean' ? null : byName.get(e.name);
            const href = e.kind === 'clean' ? '/admin?section=general' : agentHref(e.name);
            return (
              <Link
                key={`${e.kind}:${e.name}`}
                href={href}
                className="group flex h-9 items-center gap-4 rounded px-2 text-[13px] hover:bg-surface-2"
              >
                <span className="w-12 shrink-0 font-mono text-[12px] tabular-nums text-text-muted">
                  {e.at ? (isToday(e.at) ? time(e.at) : `${time(e.at)}`) : 'now'}
                </span>
                <StatusDot tone={e.kind === 'running' ? 'live' : 'muted'} />
                <span className="min-w-0 truncate font-medium text-text-primary">{e.title}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-muted">
                  {e.kind === 'running'
                    ? agent?.currentStep ?? 'running'
                    : e.kind === 'clean'
                      ? 'nightly clean'
                      : agent
                        ? agent.activation.scheduleLabel.replace(/^No schedule$/, 'on triggers')
                        : ''}
                </span>
                {e.who && <span className="shrink-0 text-[12px] text-text-muted">{e.who}</span>}
              </Link>
            );
          })}
        </div>
      )}

      {agents.length === 0 ? (
        data.agents.length > 0 && <p className="px-2 text-[13px] text-text-muted">Nothing matches.</p>
      ) : (
        groups.map((g) => (
          <section key={g.name ?? '—'} className="mb-6">
            {(g.name || groups.length > 1) && (
              <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                {g.name ?? 'Other'}
              </h3>
            )}
            <ul className="flex flex-col">
              {g.agents.map((a) => {
                const line = statusLine(a, now);
                const running = a.state.status === 'running';
                const last = a.lastRun;
                return (
                  <li key={a.name}>
                    <button
                      type="button"
                      onClick={() => onNavigate(agentHref(a.name))}
                      className="group flex h-12 w-full items-center gap-4 rounded px-2 text-left text-[13px] hover:bg-surface-2"
                    >
                      <StatusDot tone={line.tone} />
                      <span className="w-48 shrink-0 truncate font-medium text-text-primary">{a.title}</span>
                      <span
                        className={`min-w-0 flex-1 truncate ${running ? 'font-mono text-[12px] text-text-secondary' : line.problem ? (line.tone === 'bad' ? 'text-red-600' : 'text-amber-700') : 'text-text-muted'}`}
                        title={running ? a.currentStep ?? undefined : line.text}
                      >
                        {running ? a.currentStep ?? line.text : line.text}
                      </span>
                      {a.runsFor.count > 0 && (
                        <span className="hidden w-28 shrink-0 truncate text-[12px] text-text-muted md:inline">{whoLabel(a.runsFor)}</span>
                      )}
                      <span className="hidden w-28 shrink-0 truncate text-right text-[12px] tabular-nums text-text-muted lg:inline">
                        {last
                          ? last.status === 'running'
                            ? 'now'
                            : last.status === 'failed'
                              ? terminalLabel(last.terminalReason) || 'failed'
                              : fmtAgo(last.startedAt, now)
                          : a.state.nextRunAt && a.activation.active
                            ? fmtUntil(a.state.nextRunAt, now)
                            : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
