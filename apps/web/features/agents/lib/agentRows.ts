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
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * The body that turns an agent back on with the schedule and triggers it
 * already has (PATCH …/agents/<name>) — or null when it has neither, and
 * turning it on means choosing when first.
 */
export function switchOnBody(activation: AgentSummary['activation']): Record<string, unknown> | null {
  const s = activation.schedule;
  const on = activation.on;
  if (!s && !on) return null;
  const clock =
    !s
      ? {}
      : s.kind === 'interval' || s.kind === 'cron'
        ? { every: activation.every }
        : s.kind === 'hourly'
          ? { schedule: 'hourly' }
          : s.kind === 'daily'
            ? { schedule: 'daily', at: hhmm(s.hour, s.minute) }
            : { schedule: 'weekly', at: hhmm(s.hour, s.minute), on: WEEKDAYS[s.weekday] };
  return {
    active: true,
    ...clock,
    ...(on ? { triggers: { context: on.context, webhook: on.webhook } } : {}),
    debounce: `${Math.round(activation.debounceMs / 1000)}s`,
    timezone: activation.timezone,
  };
}

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
      connectors: a.connectors,
      tools: a.tools,
      runsFor: whoLabel(a.runsFor) ?? '',
      failures: a.state.consecutiveFailures || null,
    },
  };
}
