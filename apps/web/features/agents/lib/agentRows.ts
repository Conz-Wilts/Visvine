import type { AgentSummary } from '@/lib/agents/service';
import { whoLabel } from '@/lib/agents/shared/roster';
import type { DirectoryItem } from '@/lib/types';
import { fmtAgo, fmtUntil, statusLine, terminalLabel } from './rowState';

/**
 * One agent as a row of the Directory's Agents table: its record (model,
 * connectors, tools, schedule, who it runs for) and its live state, under the
 * metadata keys `columnsForType('agent')` names (lib/directory/table.ts).
 * A healthy state reads as one word; a problem reads as its whole line.
 */
export function agentTableItem(a: AgentSummary, now: number): DirectoryItem {
  const line = statusLine(a, now);
  const running = a.state.status === 'running';
  const status = running
    ? (a.currentStep ?? 'Running')
    : line.problem
      ? line.text
      : a.rowState === 'off'
        ? 'Off'
        : a.rowState === 'due'
          ? 'Starting shortly'
          : 'Scheduled';
  const schedule = [a.activation.schedule ? a.activation.scheduleLabel : null, a.activation.triggersLabel].filter(Boolean).join(' · ');
  const last = a.lastRun;
  return {
    id: `agent:${a.name}`,
    name: a.title,
    type: 'agent',
    tags: a.tags,
    metadata: {
      status,
      active: a.activation.active,
      schedule,
      nextRun: a.activation.active && a.state.nextRunAt ? fmtUntil(a.state.nextRunAt, now) : '',
      lastRun: last
        ? last.status === 'running'
          ? 'now'
          : last.status === 'failed'
            ? `${terminalLabel(last.terminalReason) || 'failed'} · ${fmtAgo(last.startedAt, now)}`
            : fmtAgo(last.startedAt, now)
        : '',
      model: a.model ?? '',
      connectors: a.connectors.join(', '),
      tools: a.tools.join(', '),
      runsFor: whoLabel(a.runsFor) ?? '',
      failures: a.state.consecutiveFailures || null,
    },
  };
}
