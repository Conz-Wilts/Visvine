'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';
import type { AgentReadiness, AgentSubscriber, AgentSummary, SerializedRun } from '@/lib/agents/service';
import ConnectorReadinessNotices from './ConnectorReadinessNotices';
import StatusDot from './StatusDot';
import { fmtAgo, fmtCents, fmtDuration, fmtUntil, terminalLabel } from '../lib/rowState';

/**
 * The agent's control column, beside its run.
 *
 * Everything here answers a question about the agent as a THING — when it
 * fires, who it fires for, what it has cost, what to say to it, what it did
 * before. The run itself is the page's subject and lives in the wide column;
 * anything you configure rather than watch is either one line here or behind
 * one of the three buttons at the foot, because a page you read every day
 * should not carry a form you touch twice a year.
 */

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <h3 className="min-w-0 flex-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="shrink-0 text-[12px] font-semibold text-brand-dark-green hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}

export interface AgentSidebarProps {
  agent: AgentSummary & { subscribers: AgentSubscriber[]; viewerSubscribed: boolean; readiness: AgentReadiness };
  runs: SerializedRun[];
  shownRunId: string | null;
  isAdmin: boolean;
  canManage: boolean;
  busy: boolean;
  /** The one thing standing between an off agent and its switch, if any. */
  blocker: { text: string; fix: 'brief' | 'key' } | null;
  onSelectRun: (runId: string) => void;
  onSchedule: () => void;
  /** Add or remove someone from the fan-out list; no id means the viewer. */
  onSubscribe: (subscribed: boolean, userId?: string) => void;
  onOpen: (panel: 'settings' | 'skills' | 'machine') => void;
  onEditBrief: () => void;
  children?: React.ReactNode;
}

export default function AgentSidebar({
  agent,
  runs,
  shownRunId,
  isAdmin,
  canManage,
  busy,
  blocker,
  onSelectRun,
  onSchedule,
  onSubscribe,
  onOpen,
  onEditBrief,
  children,
}: AgentSidebarProps) {
  const others = agent.subscribers.filter((s) => s.userId !== agent.readiness.runAsUserId);
  const names = [agent.readiness.runAsName ?? 'its author', ...others.map((s) => s.name ?? 'a member')];
  const setup = [agent.model, ...agent.connectors, ...agent.tools].filter(Boolean);
  // Who a run acted as, for the history rows — a fan-out group is one row per
  // person, and the name is what tells them apart.
  const personOf = new Map<string, string | null>(agent.subscribers.map((s) => [s.userId, s.name]));

  return (
    <aside className="flex flex-col gap-4 text-[13px] lg:sticky lg:top-4 lg:self-start">
      <Section
        title="When it runs"
        action={canManage ? <LinkButton onClick={onSchedule}>{agent.activation.active ? 'Change' : 'Turn on'}</LinkButton> : undefined}
      >
        {agent.activation.active ? (
          <p className="text-text-primary">
            {agent.activation.scheduleLabel.replace(/^No schedule$/, 'On triggers only')}
            {agent.activation.triggersLabel ? <span className="text-text-muted"> · {agent.activation.triggersLabel}</span> : null}
          </p>
        ) : blocker ? (
          <p className="text-amber-700">
            {blocker.text}
            {blocker.fix === 'brief' ? (
              <>
                {' — '}
                <button type="button" className="font-semibold text-brand-dark-green hover:underline" onClick={onEditBrief}>
                  edit the brief
                </button>
              </>
            ) : (
              isAdmin && (
                <>
                  {' — '}
                  <Link href="/admin?section=connectors" className="font-semibold text-brand-dark-green hover:underline">
                    add it
                  </Link>
                </>
              )
            )}
          </p>
        ) : (
          <p className="text-text-muted">{canManage ? 'Off. Turning it on picks the schedule.' : 'Off.'}</p>
        )}
        {agent.state.nextRunAt && agent.activation.active && (
          <p className="text-text-muted">Next run {fmtUntil(agent.state.nextRunAt)}</p>
        )}
        {/* The identity SCHEDULED runs act as: what THEY still have to connect,
            said before a 3am run discovers it instead. */}
        {agent.readiness.runAs && (
          <ConnectorReadinessNotices items={agent.readiness.runAs} mine={false} who={agent.readiness.runAsName} isAdmin={isAdmin} />
        )}
      </Section>

      <Section
        title="Runs for"
        action={
          <LinkButton onClick={() => onSubscribe(!agent.viewerSubscribed)}>{agent.viewerSubscribed ? 'Remove me' : 'Add me'}</LinkButton>
        }
      >
        <p className="text-text-primary">{names.join(', ')}</p>
        {isAdmin && others.length > 0 && (
          <p className="text-text-muted">
            {others.map((s, i) => (
              <span key={s.userId}>
                {i > 0 && ' · '}
                {s.name ?? 'a member'}{' '}
                <button
                  type="button"
                  className="text-text-muted hover:text-red-600 hover:underline"
                  disabled={busy}
                  onClick={() => onSubscribe(false, s.userId)}
                >
                  remove
                </button>
              </span>
            ))}
          </p>
        )}
        <ConnectorReadinessNotices items={agent.readiness.viewer} mine who={null} isAdmin={isAdmin} />
      </Section>

      {children && <Section title="Say something">{children}</Section>}

      {runs.length > 0 && (
        <Section title="History">
          <ul className="flex flex-col">
            {runs.slice(0, 8).map((r) => {
              const open = shownRunId === r.id;
              const forWhom = r.runAsUserId && r.runAsUserId !== agent.readiness.runAsUserId ? personOf.get(r.runAsUserId) : null;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={open ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left ${open ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
                    onClick={() => onSelectRun(r.id)}
                  >
                    <StatusDot tone={r.status === 'running' ? 'live' : r.status === 'failed' ? 'bad' : 'ok'} />
                    <span className={`min-w-0 flex-1 truncate ${open ? 'text-text-primary' : 'text-text-secondary'}`}>
                      {fmtAgo(r.startedAt)}
                      {forWhom ? <span className="text-text-muted"> · {forWhom}</span> : null}
                    </span>
                    <span className={`shrink-0 text-[11px] ${r.status === 'failed' ? 'text-red-600' : 'tabular-nums text-text-muted'}`}>
                      {r.status === 'running'
                        ? 'now'
                        : r.status === 'failed'
                          ? terminalLabel(r.terminalReason) || 'failed'
                          : fmtDuration(r.startedAt, r.endedAt)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      <Section title="Setup">
        <p className="font-mono text-[11px] leading-5 text-text-muted">{setup.join(' · ')}</p>
        {isAdmin && (
          <p className="text-text-muted">
            <span className="tabular-nums text-text-secondary">{fmtCents(agent.spend?.monthCents)}</span> this month
            {agent.spend?.budgetMonthlyCents != null ? ` · cap ${fmtCents(agent.spend.budgetMonthlyCents)}` : ''}
          </p>
        )}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {canManage && (
            <Button variant="ghost" size="sm" onClick={() => onOpen('settings')}>
              Settings
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpen('skills')}>
            Skills
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => onOpen('machine')}>
              Machine
            </Button>
          )}
        </div>
      </Section>
    </aside>
  );
}
