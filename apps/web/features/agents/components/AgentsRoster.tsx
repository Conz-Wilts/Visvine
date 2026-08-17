'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Bot, Play } from 'lucide-react';
import Toggle from '@/components/ui/Toggle';
import { fetchJson } from '@/lib/fetchJson';
import type { AgentSummary } from '@/lib/agents/service';
import { fmtAgo, fmtCents, rowStateView, terminalLabel, TONE_CLASSES } from '../lib/rowState';
import ActivateAgentDialog from './ActivateAgentDialog';

/**
 * The control room: one row per agent — name, status, schedule, last run,
 * next run, spend (admins) — with the activation toggle (admins) and Run now
 * (author or admin). Members see the whole roster minus the money; the
 * toggle is visible but disabled for them so they can see their agent was
 * turned on and by whom.
 */
export default function AgentsRoster({
  spaceId,
  agents,
  isAdmin,
  currentUserId,
  spaceTimezone,
  onChanged,
  onNotice,
}: {
  spaceId: string;
  agents: AgentSummary[];
  isAdmin: boolean;
  currentUserId: string | null;
  spaceTimezone: string | null;
  onChanged: () => void;
  onNotice: (message: string, tone: 'ok' | 'warn' | 'bad') => void;
}) {
  const [activating, setActivating] = useState<AgentSummary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = Date.now();

  const deactivate = async (a: AgentSummary) => {
    setBusy(a.name);
    try {
      await fetchJson(`/api/communities/${spaceId}/agents/${encodeURIComponent(a.name)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      onChanged();
    } catch (e) {
      onNotice(e instanceof Error ? e.message : 'Could not deactivate', 'bad');
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (a: AgentSummary) => {
    setBusy(a.name);
    // The request holds until the run finishes; the roster refreshes as it goes.
    const refresh = setInterval(onChanged, 3000);
    try {
      onNotice(`Running ${a.title || a.name}…`, 'ok');
      const res = await fetchJson<{ ok: true; outcome: { status: string; reason: string } | null; error: string | null }>(
        `/api/communities/${spaceId}/agents/${encodeURIComponent(a.name)}/run`,
        { method: 'POST' },
      );
      if (res.error) onNotice(res.error, 'bad');
      else if (res.outcome) onNotice(`${a.title || a.name}: ${res.outcome.status} (${terminalLabel(res.outcome.reason)})`, res.outcome.status === 'succeeded' ? 'ok' : 'warn');
    } catch (e) {
      onNotice(e instanceof Error ? e.message : 'Run failed', 'bad');
    } finally {
      clearInterval(refresh);
      setBusy(null);
      onChanged();
    }
  };

  if (agents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-default px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-light-bg text-brand-dark-green">
          <Bot className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-text-primary">No agents yet</p>
          <p className="mt-1 text-sm text-text-muted">
            Create one from <span className="font-semibold">Create → Agent</span>, or write an{' '}
            <code className="font-mono text-[13px]">agents/&lt;name&gt;.md</code> note in Context. An admin activates it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-border-subtle bg-surface-1 shadow-soft">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2.5 font-medium">Agent</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Schedule</th>
              <th className="px-3 py-2.5 font-medium">Last run</th>
              {isAdmin && <th className="px-3 py-2.5 text-right font-medium">Spend / mo</th>}
              <th className="px-3 py-2.5 font-medium">On</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {agents.map((a) => {
              const view = rowStateView(a, now);
              const canRun = isAdmin || (currentUserId !== null && a.authorUserId === currentUserId);
              const runnable = canRun && a.activation.active && a.state.status !== 'running' && !a.invalid;
              return (
                <tr key={a.name} className="align-top">
                  <td className="px-4 py-3">
                    <Link href={`/directory/${encodeURIComponent(`agent:${a.name}`)}`} className="group block min-w-0">
                      <p className="truncate font-semibold text-text-primary group-hover:text-brand-dark-green">{a.title || a.name}</p>
                      <p className="truncate font-mono text-[11px] text-text-muted">
                        {a.name} · {a.model ?? 'no model'}
                        {a.connectors.length > 0 ? ` · ${a.connectors.join(', ')}` : ''}
                      </p>
                      {a.description && <p className="mt-0.5 line-clamp-1 text-[13px] text-text-muted">{a.description}</p>}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[view.tone]}`}>{view.label}</span>
                    {view.detail && <p className="mt-1 max-w-[220px] text-[12px] leading-snug text-text-muted">{view.detail}</p>}
                  </td>
                  <td className="px-3 py-3 text-[13px] text-text-muted">{a.activation.schedule ? a.activation.scheduleLabel : '—'}</td>
                  <td className="px-3 py-3 text-[13px] text-text-muted">
                    {a.lastRun ? (
                      <>
                        <span className={a.lastRun.status === 'failed' ? 'text-red-700' : 'text-text-primary'}>{terminalLabel(a.lastRun.terminalReason) || a.lastRun.status}</span>
                        <br />
                        <span>{fmtAgo(a.lastRun.startedAt, now)}</span>
                      </>
                    ) : (
                      'never'
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-3 text-right text-[13px] tabular-nums text-text-muted">
                      {fmtCents(a.spend?.monthCents)}
                      {a.spend?.budgetMonthlyCents != null && <span className="text-text-muted"> / {fmtCents(a.spend.budgetMonthlyCents)}</span>}
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <Toggle
                      checked={a.activation.active}
                      disabled={!isAdmin || busy === a.name || !!a.invalid}
                      aria-label={isAdmin ? `Toggle ${a.name}` : 'Admins only'}
                      onChange={(next) => (next ? setActivating(a) : deactivate(a))}
                    />
                    {!isAdmin && <p className="mt-1 text-[10px] uppercase tracking-wide text-text-muted">admins only</p>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-border-default px-2.5 py-1 text-[12px] font-medium text-text-primary hover:border-brand-green disabled:cursor-not-allowed disabled:opacity-40"
                      disabled={!runnable || busy === a.name}
                      onClick={() => runNow(a)}
                      title={
                        !a.activation.active
                          ? 'Activate the agent first — activation is the review point'
                          : !canRun
                            ? 'Only the author or an admin can run it'
                            : 'Run now'
                      }
                    >
                      <Play className="h-3 w-3" /> Run now
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {activating && (
        <ActivateAgentDialog
          spaceId={spaceId}
          agent={activating}
          spaceTimezone={spaceTimezone}
          onClose={() => setActivating(null)}
          onDone={(warning) => {
            setActivating(null);
            onChanged();
            if (warning) onNotice(warning, 'warn');
          }}
        />
      )}
    </>
  );
}
