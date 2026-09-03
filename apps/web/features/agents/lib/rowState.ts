import type { AgentRowState, AgentSummary } from '@/lib/agents/service';

// The status palette is shared with connectors and Tools — see statusTone.
import type { Tone } from '@/features/shared/lib/statusTone';

/**
 * What one agent says about itself in a single line: its tone (drawn as a
 * dot), the line, and whether the line is a problem that should read in the
 * tone's colour rather than muted. A healthy agent's line is its schedule.
 */
export interface StatusLine {
  tone: Tone;
  text: string;
  problem: boolean;
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

/** The schedule in plain words — "Daily at 07:00; on people/**" — or null. */
function scheduleText(a: AgentSummary): string | null {
  const parts = [a.activation.schedule ? a.activation.scheduleLabel : null, a.activation.triggersLabel].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** The one line a row shows under the agent's name. */
export function statusLine(a: AgentSummary, now = Date.now()): StatusLine {
  const s: AgentRowState = a.rowState;
  const next = a.state.nextRunAt ? `next ${until(a.state.nextRunAt, now)}` : null;
  switch (s) {
    case 'invalid':
      return { tone: 'bad', text: `Invalid brief — ${a.invalid ?? a.activation.invalid ?? ''}`, problem: true };
    case 'running':
      return { tone: 'live', text: a.state.runningSince ? `Running · started ${ago(a.state.runningSince, now)}` : 'Running', problem: false };
    case 'deactivated':
      return {
        tone: 'bad',
        text: `Turned off — ${REASON_LABEL[a.state.deactivatedReason ?? ''] ?? a.state.deactivatedReason ?? ''}${a.state.deactivatedDetail ? `: ${a.state.deactivatedDetail}` : ''}`,
        problem: true,
      };
    case 'off':
      return { tone: 'muted', text: scheduleText(a) ?? 'Off', problem: false };
    case 'needs_key':
      return { tone: 'warn', text: `No ${a.model?.split('/')[0] ?? 'model'} key — add it on the model's page`, problem: true };
    case 'budget':
      return { tone: 'warn', text: 'Paused — monthly budget reached', problem: true };
    case 'due':
      return { tone: 'live', text: 'Starting shortly', problem: false };
    case 'delayed':
      return { tone: 'bad', text: 'Overdue — the scheduler has not picked it up', problem: true };
    case 'failed':
      return {
        tone: 'warn',
        text: [`Failed — ${terminalLabel(a.lastRun?.terminalReason ?? null) || 'error'}`, next].filter(Boolean).join(' · '),
        problem: true,
      };
    case 'scheduled':
    default:
      return { tone: 'ok', text: [scheduleText(a) ?? 'Waiting for a trigger', next].filter(Boolean).join(' · '), problem: false };
  }
}

/** The dot that carries a tone. `live` breathes. */
export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-brand-green',
  warn: 'bg-amber-500',
  bad: 'bg-red-500',
  muted: 'bg-border-default',
  live: 'bg-sky-500 dot-pulse [--pulse-color:rgba(14,165,233,0.4)]',
};

export function fmtAgo(iso: string | null, now = Date.now()): string {
  return ago(iso, now);
}

/** A moment still ahead, in the unit that reads: "in 12 min", "in 3 h". */
export function fmtUntil(iso: string | null, now = Date.now()): string {
  return until(iso, now);
}

/** A run's length, in the unit that reads: "42s", "2m 0s", "1h 05m". */
export function fmtDuration(startedAt: string, endedAt: string | null): string | null {
  if (!endedAt) return null;
  const s = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

export function fmtCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents > 0 && cents < 1) return '<$0.01';
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * What stands between an off agent and its switch, as one sentence — or
 * nothing, when the only thing missing is the switch itself. The three
 * labelled steps this replaced said "Brief ✓ / Model key ✓ / When it runs" on
 * an agent whose real state was "not on yet"; a connector row says nothing
 * when it is healthy and names the one failure when it is not, and an agent
 * has the same two answers.
 */
export function setupBlocker(a: AgentSummary, isAdmin: boolean): { text: string; fix: 'brief' | 'key' } | null {
  // The message itself is already on the page as an alert; this line is the
  // way out of it, not a second copy.
  if (a.invalid) return { text: 'The brief has a problem', fix: 'brief' };
  // The server already phrased this for whoever is reading it — no model in the
  // space, no key, a connector switched off — so the line is that sentence
  // rather than a second guess assembled from the brief's `model:`, which is
  // usually absent now (the agent runs on the space's model).
  if (a.modelProblem) {
    return { text: isAdmin ? a.modelProblem : shortenForMember(a.modelProblem), fix: 'key' };
  }
  return null;
}

/**
 * The same problem, for someone who cannot fix it: they need to know they are
 * waiting on an admin, not what to type. The server's sentence ends in an
 * instruction ("Add one under Models"), which is the half that
 * does not apply.
 */
function shortenForMember(problem: string): string {
  const [first] = problem.split('. ');
  return `${first} — an admin sets this up.`;
}
