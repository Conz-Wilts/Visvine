import type { AgentRowState, AgentSummary } from '@/lib/agents/service';

// The status palette is shared with connectors and Tools — see statusTone.
import type { Tone } from '@/features/shared/lib/statusTone';

export interface RowStateView {
  label: string;
  detail: string;
  tone: Tone;
}

function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function until(iso: string | null, now: number): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  const m = Math.round(ms / 60_000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} d`;
}

const REASON_LABEL: Record<string, string> = {
  brief_changed: 'brief changed',
  key_rejected: 'model key rejected',
  repeated_failure: 'repeated failures',
  author_gone: 'author left the space',
  renamed: 'renamed',
  deleted: 'deleted',
  config: 'configuration problem',
  admin: 'turned off',
};

const TERMINAL_LABEL: Record<string, string> = {
  finished: 'finished',
  max_turns: 'hit the turn cap',
  budget: 'monthly budget reached',
  run_cap: 'per-run cap reached',
  timeout: 'timed out',
  crashed: 'crashed',
  error: 'error',
  auth: 'model key rejected',
  quota: 'provider quota',
  upstream: 'provider error',
  config: 'configuration problem',
  author_gone: 'author left',
  aborted: 'aborted',
};

export function terminalLabel(reason: string | null): string {
  return reason ? (TERMINAL_LABEL[reason] ?? reason) : '';
}

/** What the roster row says for each state, in the panel's own words. */
export function rowStateView(a: AgentSummary, now = Date.now()): RowStateView {
  const s: AgentRowState = a.rowState;
  switch (s) {
    case 'invalid':
      return { label: 'Invalid config', detail: a.invalid ?? a.activation.invalid ?? '', tone: 'bad' };
    case 'running':
      return { label: 'Running', detail: a.state.runningSince ? `since ${ago(a.state.runningSince, now)}` : '', tone: 'live' };
    case 'needs_reactivation':
      return {
        label: 'Needs re-activation',
        detail: a.state.deactivatedDetail ? `${a.state.deactivatedDetail} — an admin must re-activate` : 'brief changed',
        tone: 'warn',
      };
    case 'deactivated':
      return {
        label: 'Deactivated',
        detail: `${REASON_LABEL[a.state.deactivatedReason ?? ''] ?? a.state.deactivatedReason ?? ''}${a.state.deactivatedDetail ? ` — ${a.state.deactivatedDetail}` : ''}`,
        tone: 'bad',
      };
    case 'off':
      return { label: 'Off', detail: 'not activated', tone: 'muted' };
    case 'needs_key':
      return { label: 'Needs model key', detail: `no key stored for ${a.model?.split('/')[0] ?? 'this provider'}`, tone: 'warn' };
    case 'budget':
      return { label: 'Paused — budget', detail: 'monthly budget reached; resumes next month or when raised', tone: 'warn' };
    case 'due':
      return { label: 'Due', detail: 'running shortly', tone: 'live' };
    case 'delayed':
      return { label: 'Delayed', detail: 'due but not picked up — the scheduler may be down', tone: 'bad' };
    case 'failed':
      return {
        label: 'Failed',
        detail: `last run: ${terminalLabel(a.lastRun?.terminalReason ?? null)}${a.state.nextRunAt ? ` · next ${until(a.state.nextRunAt, now)}` : ''}`,
        tone: 'warn',
      };
    case 'scheduled':
    default:
      return { label: 'Scheduled', detail: a.state.nextRunAt ? `next ${until(a.state.nextRunAt, now)}` : a.activation.schedule ? a.activation.scheduleLabel : (a.activation.triggersLabel ?? 'waiting for a trigger'), tone: 'ok' };
  }
}

export function fmtAgo(iso: string | null, now = Date.now()): string {
  return ago(iso, now);
}

export function fmtCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents > 0 && cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}
