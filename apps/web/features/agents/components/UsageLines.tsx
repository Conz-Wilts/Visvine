'use client';

import { fmtCents } from '@/features/agents/lib/rowState';
import type { UsageLine } from '@/lib/agents/shared/usage';

/**
 * The bill's building blocks, shared by the console's Usage section and a
 * model's own page: tokens as a person reads them, a month's name, and the
 * by-model / by-agent table with "tokens only" where nothing was priced.
 */

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

export function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function LinesTable({ title, lines, nameOf }: {
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
