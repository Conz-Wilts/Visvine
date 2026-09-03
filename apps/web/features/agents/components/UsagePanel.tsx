'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Input, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';
import { fmtCents } from '@/features/agents/lib/rowState';
import { agentPageHref } from '@/lib/agents/config';
import type { MonthUsage, UsageLine } from '@/lib/agents/shared/usage';

/**
 * Usage, as a console section: what the space's agents spent on models, per
 * month — the durable agent_model_usage rollup, not the prunable run rows, so
 * an old month keeps its answer. The current month leads with its by-model and
 * by-agent breakdowns; earlier months are one line each. Dollars are what the
 * space's own provider keys were billed (Visvine never bills for tokens);
 * a run on a model nobody priced counts tokens only, and the panel says how
 * many of those there were rather than pretending the total is complete.
 */

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function LinesTable({ title, lines, nameOf }: {
  title: string;
  lines: UsageLine[];
  /** Render the key cell — the agent line links to the agent's page. */
  nameOf?: (key: string) => React.ReactNode;
}) {
  if (lines.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">{title}</h3>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
            <th className="py-1 pr-3 font-normal" />
            <th className="py-1 pr-3 text-right font-normal">Runs</th>
            <th className="py-1 pr-3 text-right font-normal">In</th>
            <th className="py-1 pr-3 text-right font-normal">Out</th>
            <th className="py-1 text-right font-normal">Cost</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-b border-border-subtle last:border-b-0">
              <td className="py-1.5 pr-3 font-mono text-[12px] text-text-primary">
                {nameOf ? nameOf(line.key) : line.key}
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{line.runs}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{fmtTokens(line.promptTokens)}</td>
              <td className="py-1.5 pr-3 text-right tabular-nums text-text-muted">{fmtTokens(line.completionTokens)}</td>
              <td className="py-1.5 text-right tabular-nums text-text-primary">
                {line.unpricedRuns === line.runs ? 'tokens only' : fmtCents(line.costCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The space-wide monthly cap, inline-editable the way an agent's is on its
 * page. Empty = no cap. Compared against the whole ledger, so every agent and
 * every teaching counts toward it; runs pause until next month when it binds.
 */
function SpaceCapLine({ spaceId, capCents, monthCents, onSaved }: {
  spaceId: string;
  capCents: number | null;
  monthCents: number;
  onSaved: (cents: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(capCents != null ? String(capCents / 100) : '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    const dollars = input.trim() === '' ? null : Number(input);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0)) {
      setNotice('The cap is a dollar amount, or empty for none.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const cents = dollars === null ? null : Math.round(dollars * 100);
      await fetchJson(`/api/communities/${spaceId}/usage`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ budgetMonthlyCents: cents }),
      });
      onSaved(cents);
      setEditing(false);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not save the cap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-[13px]">
      <p className="text-text-primary">
        <span className="font-semibold tabular-nums">{fmtCents(monthCents)}</span>
        <span className="text-text-muted"> this month, all agents</span>
      </p>
      <span className="text-border-default">·</span>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input
            className="w-28"
            inputMode="decimal"
            autoFocus
            placeholder="no cap"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <Button variant="ghost" size="sm" onClick={save} disabled={busy}>
            Save
          </Button>
        </div>
      ) : (
        <button type="button" className="text-text-muted hover:text-text-primary hover:underline" onClick={() => setEditing(true)}>
          {capCents != null ? `space cap ${fmtCents(capCents)}` : 'no space cap'}
        </button>
      )}
      {notice && <span className="text-xs text-red-600">{notice}</span>}
    </div>
  );
}

export default function UsagePanel({ spaceId }: { spaceId: string }) {
  const [months, setMonths] = useState<MonthUsage[] | null>(null);
  const [capCents, setCapCents] = useState<number | null>(null);
  const [currentMonth, setCurrentMonth] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ months: MonthUsage[]; budgetMonthlyCents: number | null; currentMonth: string }>(
      `/api/communities/${spaceId}/usage`,
    )
      .then((data) => {
        if (cancelled) return;
        setMonths(data.months);
        setCapCents(data.budgetMonthlyCents);
        setCurrentMonth(data.currentMonth);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load usage.'); });
    return () => { cancelled = true; };
  }, [spaceId]);

  if (error) return <Alert variant="error">{error}</Alert>;
  if (!months) return <Skeleton className="h-40 w-full" />;

  const [current, ...earlier] = months;
  const currentMonthCents = currentMonth && current?.month === currentMonth ? current.costCents : 0;

  return (
    <div className="space-y-8">
      <p className="text-[13px] text-text-muted">
        What this space&apos;s agents spent on models, billed to its own provider keys. Every finished run is counted
        the month it started; a run on a model without a known price counts tokens only. The space cap pauses every
        agent when the month&apos;s total reaches it — each agent&apos;s own cap still applies first.
      </p>

      <SpaceCapLine spaceId={spaceId} capCents={capCents} monthCents={currentMonthCents} onSaved={setCapCents} />

      {!current ? (
        <p className="text-sm text-text-muted">No agent runs recorded yet.</p>
      ) : (
        <section className="space-y-5">
          <div className="flex items-baseline gap-3 border-b border-border-subtle pb-3">
            <h2 className="text-sm font-medium text-text-primary">{monthLabel(current.month)}</h2>
            <span className="text-lg font-semibold tabular-nums text-text-primary">{fmtCents(current.costCents)}</span>
            <span className="text-[13px] text-text-muted">
              {current.runs} run{current.runs === 1 ? '' : 's'} · {fmtTokens(current.promptTokens)} in ·{' '}
              {fmtTokens(current.completionTokens)} out
            </span>
          </div>
          {current.unpricedRuns > 0 && (
            <p className="text-xs text-text-muted">
              {current.unpricedRuns} run{current.unpricedRuns === 1 ? '' : 's'} on unpriced models — not in the dollar
              total. An admin can declare prices in the model note&apos;s <code className="font-mono">pricing:</code>.
            </p>
          )}
          <LinesTable title="By model" lines={current.byModel} />
          <LinesTable
            title="By agent"
            lines={current.byAgent}
            nameOf={(name) => (
              <Link href={agentPageHref(name)} className="hover:underline">
                {name}
              </Link>
            )}
          />
        </section>
      )}

      {earlier.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Earlier months</h3>
          <ul className="text-[13px]">
            {earlier.map((m) => (
              <li key={m.month} className="flex items-baseline justify-between border-b border-border-subtle py-1.5 last:border-b-0">
                <span className="text-text-primary">{monthLabel(m.month)}</span>
                <span className="text-text-muted">
                  {m.runs} run{m.runs === 1 ? '' : 's'} · {fmtTokens(m.promptTokens + m.completionTokens)} tokens ·{' '}
                  <span className="tabular-nums text-text-primary">{fmtCents(m.costCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
