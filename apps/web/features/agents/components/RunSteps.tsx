'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import Link from '@/features/shared/components/SpaceLink';
import { ChevronRightIcon } from '@/features/shared/icons';
import type { AgentRunEvent } from '@/lib/agents/runs';
import { TOOL_VERB, attachMachine, groupSteps, stepFailed, stepsOf, type MachineEvent, type Step, type StepGroup } from '@/lib/agents/shared/trace';
import { hrefForNotePath } from '@/lib/notes/entities';
import StatusDot from './StatusDot';

/**
 * A run as a short numbered list: one row per thing the agent set out to do,
 * titled in its own words, with the calls it made to do it folded under the
 * row. A row opens onto its subtasks; a subtask opens onto what came back, or
 * the machine's own record of it.
 *
 * Rows are flat — a hairline between them, no borders of their own — and only
 * what is exceptional carries colour: a breathing dot on the row in flight,
 * red on one that was refused.
 *
 * Pure over its input: the same component renders a finished run and one in
 * flight — `live` only decides whether the open row follows the tail.
 */

/** A written path in a write step's result ("written people/x/index.md") — for the link. */
function writtenPath(step: Step): string | null {
  if (step.tool !== 'write_context' && step.tool !== 'append_context') return null;
  const m = /^(?:written|appended to) (\S+)$/m.exec(step.result ?? '');
  return m ? m[1] : null;
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

/** One line of the machine's record, in the terminal's own words. */
function machineLine(event: MachineEvent): { text: string; tone: 'cmd' | 'out' | 'bad' | 'meta' } | null {
  const p = event.payload ?? {};
  switch (event.kind) {
    case 'exec':
      return { text: `$ ${Array.isArray(p.cmd) ? (p.cmd as string[]).join(' ') : ''}`, tone: 'cmd' };
    case 'output':
      return typeof p.text === 'string' && p.text.trim() ? { text: p.text.trimEnd(), tone: 'out' } : null;
    case 'exit':
      return { text: p.timedOut ? 'timed out' : `exit ${String(p.exitCode ?? '?')}`, tone: Number(p.exitCode) === 0 ? 'meta' : 'bad' };
    case 'boot':
      return { text: `machine woke${p.workspaceRestored ? ' · workspace restored' : ''}`, tone: 'meta' };
    case 'wake':
      return { text: 'machine woke', tone: 'meta' };
    case 'sleep':
      return { text: 'machine slept', tone: 'meta' };
    case 'error':
      return { text: typeof p.message === 'string' ? p.message : 'error', tone: 'bad' };
    case 'egress_denied':
      return { text: `refused ${String(p.method ?? '')} ${String(p.host ?? '')}${p.reason ? ` — ${String(p.reason)}` : ''}`.trim(), tone: 'bad' };
    case 'browse':
      return { text: `opened ${String(p.url ?? '')}`, tone: 'cmd' };
    default:
      return null;
  }
}

const MACHINE_TONE: Record<'cmd' | 'out' | 'bad' | 'meta', string> = {
  cmd: 'text-fg',
  out: 'text-fg-secondary',
  bad: 'text-danger',
  meta: 'text-fg-muted italic',
};

function MachineRecord({ events }: { events: MachineEvent[] }) {
  const lines = events.map(machineLine).filter((l): l is NonNullable<typeof l> => l !== null);
  if (lines.length === 0) return null;
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle px-3 py-2 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className={MACHINE_TONE[l.tone]}>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

function Chevron({ open }: { open: boolean }) {
  return <ChevronRightIcon className={`h-3.5 w-3.5 shrink-0 text-fg-muted transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />;
}

/** One call: the verb, what it touched, how long. Opens onto its result. */
function Subtask({ step, live, now }: { step: Step; live: boolean; now: number }) {
  const [open, setOpen] = useState(false);
  const running = step.result === undefined;
  const failed = stepFailed(step);
  const took = step.endedAt !== undefined ? step.endedAt - step.at : running && live ? now - step.at : null;
  const path = writtenPath(step);
  const result = step.result ?? '';
  const hasMachine = !!step.machine?.length;
  const expandable = hasMachine || !!result;

  return (
    <li>
      <div
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (expandable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className={`flex h-8 items-center gap-2 rounded px-2 text-[12.5px] ${expandable ? 'cursor-pointer hover:bg-surface-subtle' : ''}`}
      >
        <span className={`shrink-0 ${failed ? 'text-danger' : 'text-fg-muted'}`}>{TOOL_VERB[step.tool ?? '']?.verb ?? step.tool ?? 'Did'}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg-secondary" title={step.detail}>
          {path ? (
            <Link className="hover:text-accent-strong hover:underline" href={hrefForNotePath(path, null)} onClick={(e) => e.stopPropagation()}>
              {step.detail}
            </Link>
          ) : (
            step.detail
          )}
        </span>
        {took !== null && <span className="shrink-0 text-[11.5px] tabular-nums text-fg-muted">{duration(took)}</span>}
      </div>
      {open && (
        <div className="px-2 pb-2">
          {hasMachine ? (
            <>
              <MachineRecord events={step.machine!} />
              {result && failed && <p className="mt-1 font-mono text-[12px] text-danger">{result.split('\n')[0]}</p>}
            </>
          ) : (
            <p className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-subtle px-3 py-2 font-mono text-[12px] leading-5 text-fg-secondary">
              {result}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** One step: its number, what it was for, how many calls it took. Opens onto them. */
function GroupRow({ group, n, live, now, defaultOpen }: { group: StepGroup; n: number; live: boolean; now: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const running = live && group.state === 'running';
  // The title already is the first sentence, so the words are worth showing
  // only when the model said more than that.
  const more = group.text && group.text.length > group.title.length + 12 ? group.text : null;
  const expandable = group.subtasks.length > 0 || !!more || group.notes.length > 0;

  return (
    <li className="border-b border-line-subtle">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-11 w-full items-center gap-3 px-1 text-left ${expandable ? 'hover:bg-surface-subtle' : 'cursor-default'}`}
      >
        <span className="flex w-5 shrink-0 justify-center text-[12px] tabular-nums text-fg-muted">{running ? <StatusDot tone="live" /> : n}</span>
        <span className={`min-w-0 flex-1 truncate text-[13.5px] text-fg`}>{group.title}</span>
        {group.subtasks.length > 0 && <span className={`shrink-0 text-[12px] tabular-nums ${group.state === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>{group.subtasks.length}</span>}
        {expandable && <Chevron open={open} />}
      </button>
      {open && expandable && (
        <div className="pb-2 pl-8">
          {more && <p className="whitespace-pre-wrap break-words px-2 pb-1.5 text-[12.5px] text-fg-muted">{more}</p>}
          {group.notes.map((note, i) => (
            <p key={i} className="px-2 pb-1 text-[12px] text-warning">
              {note}
            </p>
          ))}
          <ul className="flex flex-col">
            {group.subtasks.map((step, i) => (
              <Subtask key={i} step={step} live={live} now={now} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export default function RunSteps({
  events,
  machine,
  live,
  /** Words for an empty trace — "Starting…" while live, "Nothing recorded." after. */
  emptyText,
}: {
  events: AgentRunEvent[];
  /** The machine's timeline for this run, nested under the steps that drove it. */
  machine?: MachineEvent[] | null;
  live: boolean;
  emptyText?: string;
}) {
  const groups = useMemo(() => groupSteps(attachMachine(stepsOf(events), machine ?? [])), [events, machine]);
  // A one-second clock only while something is open, so a running call's
  // duration counts up rather than sitting at the last flush.
  const [now, setNow] = useState(() => Date.now());
  const anyOpen = live && groups.some((g) => g.state === 'running');
  const visible = usePageVisible();
  useEffect(() => {
    if (!anyOpen || !visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyOpen, visible]);

  // Follow the tail while live, the way a terminal does.
  const tail = useRef<HTMLLIElement | null>(null);
  const calls = groups.reduce((n, g) => n + g.subtasks.length, 0);
  useEffect(() => {
    if (live) tail.current?.scrollIntoView({ block: 'nearest' });
  }, [live, groups.length, calls]);

  if (groups.length === 0) {
    return <p className="text-[13px] text-fg-muted">{emptyText ?? (live ? 'Starting…' : 'Nothing recorded.')}</p>;
  }

  return (
    <ol className="flex flex-col">
      {groups.map((group, i) => (
        // Keyed by position AND liveness: the step in flight is open, and
        // closes itself when the next one starts.
        <GroupRow key={`${i}:${live && i === groups.length - 1}`} group={group} n={i + 1} live={live} now={now} defaultOpen={live && i === groups.length - 1} />
      ))}
      <li ref={tail} aria-hidden className="h-px" />
    </ol>
  );
}
