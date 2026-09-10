'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import Link from 'next/link';
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  ListIcon,
  MailIcon,
  PencilIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WaypointsIcon,
  XIcon,
} from '@/features/shared/icons';
import type { AgentRunEvent, RunInput } from '@/lib/agents/runs';
import { attachMachine, stepsOf, type MachineEvent, type Step } from '@/lib/agents/shared/trace';
import { hrefForNotePath } from '@/lib/notes/entities';

/**
 * A run as a column of CAPSULES: what woke it at the top, one capsule per tool
 * call — a round badge saying how it went, the verb and what it touched, how
 * long on the right — and how it ended at the bottom, each joined to the next
 * by a short hairline. A capsule opens on a click to show the tool's result
 * (or the machine's own record) under it.
 *
 * The badge is the only thing that carries tone: a numbered ring while a step
 * is open (sweeping while live), a green check when it went well, a red cross
 * when it did not. Twenty finished steps read as one quiet column. The
 * model's own words sit between capsules as the reasoning that led from one
 * to the next; the executor's notes are amber asides.
 *
 * Pure over its input: the same component renders a finished transcript and a
 * run in flight — `live` only decides whether the open badge spins and
 * whether the view follows the tail.
 */

/** The verb a tool reads as, and the icon beside it. */
const TOOL_VERB: Record<string, { verb: string; Icon: (props: { className?: string }) => React.ReactNode }> = {
  list_context: { verb: 'Listed', Icon: ListIcon },
  search_context: { verb: 'Searched', Icon: SearchIcon },
  read_context: { verb: 'Read', Icon: FileTextIcon },
  write_context: { verb: 'Wrote', Icon: PencilIcon },
  append_context: { verb: 'Appended to', Icon: PencilIcon },
  run_connector: { verb: 'Called', Icon: PlugIcon },
  fetch_url: { verb: 'Fetched', Icon: GlobeIcon },
  run_command: { verb: 'Ran', Icon: CodeIcon },
  open_page: { verb: 'Opened', Icon: GlobeIcon },
  run_agent: { verb: 'Started agent', Icon: BotIcon },
  create_node: { verb: 'Created', Icon: PlusIcon },
  link_nodes: { verb: 'Linked', Icon: WaypointsIcon },
};

/** What woke the run, as the column's first capsule. */
export interface TriggerNode {
  /** 'scheduled' | 'interval' | 'manual' | 'event' | 'webhook' — decides the icon. */
  kind: string;
  label: string;
  events: NonNullable<RunInput['events']> | null;
}

/** How the run ended, as the column's last capsule. Absent while it is still going. */
export interface EndNode {
  tone: 'ok' | 'bad';
  label: string;
}

const TRIGGER_ICON: Record<string, (props: { className?: string }) => React.ReactNode> = {
  scheduled: ClockIcon,
  interval: ClockIcon,
  manual: PlayIcon,
  event: MailIcon,
  webhook: MailIcon,
};

/** A result that begins with "error" is a refusal the model had to work around. */
function stepFailed(step: Step): boolean {
  return step.kind === 'tool' && typeof step.result === 'string' && /^error\b/i.test(step.result.trimStart());
}

/** A written path in a write step's result ("written people/x/index.md") — for the link. */
function writtenPath(step: Step): string | null {
  if (step.tool !== 'write_context' && step.tool !== 'append_context') return null;
  const m = /^(?:written|appended to) (\S+)$/m.exec(step.result ?? '');
  return m ? m[1] : null;
}

function offset(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} m ${Math.round((ms % 60_000) / 1000)} s`;
}

const TRIGGER_EVENTS_SHOWN = 5;

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
  cmd: 'text-text-primary',
  out: 'text-text-secondary',
  bad: 'text-red-600',
  meta: 'text-text-muted italic',
};

function MachineRecord({ events }: { events: MachineEvent[] }) {
  const lines = events.map(machineLine).filter((l): l is NonNullable<typeof l> => l !== null);
  if (lines.length === 0) return null;
  return (
    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className={MACHINE_TONE[l.tone]}>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

type Tone = 'ok' | 'bad' | 'live' | 'pending' | 'muted';

/**
 * The round badge at the head of a capsule. Solid green or red once a step
 * has an outcome; a ring carrying the step's number while it is open, its arc
 * sweeping while the run is live; a quiet ring with the trigger's or end's
 * icon otherwise.
 */
function Badge({ tone, n, Icon }: { tone: Tone; n?: number; Icon?: (props: { className?: string }) => React.ReactNode }) {
  if (tone === 'ok') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-white">
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (tone === 'bad') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-red-500 text-white">
        <XIcon className="h-3 w-3" />
      </span>
    );
  }
  const size = 24;
  const stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center">
      <svg width={size} height={size} className={`absolute inset-0 ${tone === 'live' ? 'animate-spin' : ''}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="stroke-border-default" strokeWidth={stroke} />
        {tone === 'live' && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            className="stroke-text-secondary"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-text-primary">
        {n !== undefined ? n : Icon ? <Icon className="h-3 w-3 text-text-muted" /> : null}
      </span>
    </span>
  );
}

/**
 * One capsule: the badge, the title (verb, then what it touched in mono), the
 * duration on the right, and a chevron when there is something to open. The
 * detail drops down under it, indented past the badge, and the short line
 * under every capsule but the last is what joins it to the next.
 */
function Capsule({
  tone,
  n,
  Icon,
  title,
  detail,
  detailHref,
  right,
  last,
  defaultOpen,
  children,
}: {
  tone: Tone;
  n?: number;
  Icon?: (props: { className?: string }) => React.ReactNode;
  title: string;
  detail?: string | null;
  detailHref?: string | null;
  right?: string | null;
  last?: boolean;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const expandable = children !== undefined && children !== null && children !== false;
  return (
    <li className="flex flex-col items-start">
      <div
        className={`w-full overflow-hidden border bg-surface-1 transition-[border-radius] duration-300 ${
          tone === 'bad' ? 'border-red-200' : tone === 'live' ? 'border-sky-200' : 'border-border-subtle'
        }`}
        style={{ borderRadius: open ? 14 : 22 }}
      >
        <button
          type="button"
          aria-expanded={expandable ? open : undefined}
          disabled={!expandable}
          onClick={() => expandable && setOpen((o) => !o)}
          className={`flex h-11 w-full items-center gap-2.5 px-2.5 text-left ${expandable ? 'hover:bg-surface-2' : 'cursor-default'}`}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center">
            <Badge tone={tone} n={n} Icon={Icon} />
          </span>
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className={`shrink-0 text-[13px] font-medium ${tone === 'bad' ? 'text-red-600' : 'text-text-primary'}`}>{title}</span>
            {detail && (
              <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary" title={detail}>
                {detailHref ? (
                  <Link className="hover:text-brand-dark-green hover:underline" href={detailHref} onClick={(e) => e.stopPropagation()}>
                    {detail}
                  </Link>
                ) : (
                  detail
                )}
              </span>
            )}
          </span>
          {right && <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{right}</span>}
          {expandable && (
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center text-text-muted">
              <ChevronDownIcon
                className="h-3.5 w-3.5 transition-transform duration-300"
                style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
              />
            </span>
          )}
        </button>
        {expandable && (
          <div
            className="grid transition-[grid-template-rows,opacity] duration-300"
            style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0, transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
          >
            <div className="overflow-hidden">
              <div className="grid grid-cols-[24px_1fr] gap-2.5 px-2.5 pb-2.5">
                <span aria-hidden className="mx-auto h-full w-px bg-border-subtle" />
                <div className="min-w-0">{children}</div>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* The joint to the next capsule: a short line under the badge's centre. */}
      {!last && <span aria-hidden className="ml-[22px] h-2.5 w-px bg-border-default" />}
    </li>
  );
}

function ToolCapsule({ step, n, live, now, last }: { step: Step; n: number; live: boolean; now: number; last: boolean }) {
  const meta = TOOL_VERB[step.tool ?? ''] ?? { verb: step.tool ?? 'Did', Icon: SparklesIcon };
  const running = step.result === undefined;
  const failed = stepFailed(step);
  const took = step.endedAt !== undefined ? step.endedAt - step.at : running && live ? now - step.at : null;
  const path = writtenPath(step);
  const result = step.result ?? '';
  const tone: Tone = running ? (live ? 'live' : 'pending') : failed ? 'bad' : 'ok';
  // The machine's record says more than the tool's one-line result, so a
  // machine step shows the terminal and folds the result away.
  const hasMachine = !!step.machine?.length;

  return (
    <Capsule
      tone={tone}
      n={running ? n : undefined}
      title={meta.verb}
      detail={step.detail}
      detailHref={path ? hrefForNotePath(path, null) : null}
      right={took !== null ? duration(took) : null}
      last={last}
    >
      {hasMachine ? (
        <>
          <MachineRecord events={step.machine!} />
          {result && failed && <p className="mt-1 font-mono text-[12px] text-red-600">{result.split('\n')[0]}</p>}
        </>
      ) : result ? (
        <p className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-text-secondary">{result}</p>
      ) : running ? (
        <p className="font-mono text-[12px] text-text-muted">working…</p>
      ) : null}
    </Capsule>
  );
}

export default function RunSteps({
  events,
  machine,
  live,
  startedAt,
  trigger,
  end,
  /** Words for an empty trace — "Starting…" while live, "Nothing recorded." after. */
  emptyText,
  /** Cap the height and scroll inside, following the tail while live. */
  scroll = live,
}: {
  events: AgentRunEvent[];
  /** The machine's timeline for this run, nested under the steps that drove it. */
  machine?: MachineEvent[] | null;
  live: boolean;
  startedAt: number;
  /** The column's first capsule — what woke the run. Omitted, the column starts at the first step. */
  trigger?: TriggerNode | null;
  /** The column's last capsule — how it ended. Omitted while the run is going. */
  end?: EndNode | null;
  emptyText?: string;
  scroll?: boolean;
}) {
  const steps = useMemo(() => attachMachine(stepsOf(events), machine ?? []), [events, machine]);
  // A one-second clock only while something is open, so a running step's
  // duration counts up rather than sitting at the last flush.
  const [now, setNow] = useState(() => Date.now());
  const anyOpen = live && steps.some((s) => s.kind === 'tool' && s.result === undefined);
  const visible = usePageVisible();
  useEffect(() => {
    if (!anyOpen || !visible) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyOpen, visible]);

  // Follow the tail while live, the way a terminal does — unless the person
  // has scrolled up to read something, in which case leave them there.
  const tail = useRef<HTMLLIElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const machineCount = machine?.length ?? 0;
  useEffect(() => {
    if (!live || !box.current || !tail.current) return;
    const el = box.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) tail.current.scrollIntoView({ block: 'end' });
  }, [live, steps.length, machineCount]);

  if (steps.length === 0 && !trigger) {
    return <p className="text-[13px] text-text-muted">{emptyText ?? (live ? 'Starting…' : 'Nothing recorded.')}</p>;
  }

  const TriggerIcon = trigger ? (TRIGGER_ICON[trigger.kind] ?? PlayIcon) : PlayIcon;
  const extraEvents = trigger?.events ? trigger.events.length - TRIGGER_EVENTS_SHOWN : 0;
  // The last capsule closes the column; while live the column stays open at
  // the bottom, so nothing is last.
  const lastToolIndex = end || live ? -1 : steps.reduce((acc, s, i) => (s.kind === 'tool' ? i : acc), -1);
  let toolNumber = 0;

  return (
    <div ref={box} className={scroll ? 'max-h-[34rem] overflow-y-auto pr-1' : ''}>
      <ol className="flex flex-col">
        {trigger && (
          <Capsule tone={live && steps.length === 0 ? 'live' : 'muted'} Icon={TriggerIcon} title={trigger.label} last={steps.length === 0 && !end && !live}>
            {trigger.events && trigger.events.length > 0 ? (
              <ol className="flex flex-col gap-0.5 font-mono text-[12px]">
                {trigger.events.slice(0, TRIGGER_EVENTS_SHOWN).map((e, i) => (
                  <li key={i} className="truncate" title={`${e.source} — ${e.summary}`}>
                    <span className="text-sky-700">{e.kind}</span> {e.source} <span className="text-text-muted">— {e.summary}</span>
                  </li>
                ))}
                {extraEvents > 0 && <li className="text-text-muted">+{extraEvents} more</li>}
              </ol>
            ) : null}
          </Capsule>
        )}

        {steps.map((step, i) => {
          if (step.kind === 'tool') {
            toolNumber += 1;
            return <ToolCapsule key={i} step={step} n={toolNumber} live={live} now={now} last={i === lastToolIndex} />;
          }
          if (step.kind === 'thought') {
            // The model's words are the joint's annotation, not a capsule:
            // they sit beside the line, between the step that ended and the
            // one they led to.
            return (
              <li key={i} className="py-1.5 pl-10">
                <p className="whitespace-pre-wrap break-words text-[13px] text-text-secondary">{step.text}</p>
              </li>
            );
          }
          return (
            <li key={i} className="py-1.5 pl-10">
              <p className="text-[12px] text-amber-700">
                <TriangleAlertIcon className="relative top-[2px] mr-1.5 inline h-3 w-3" />
                {step.text}
                <span className="ml-2 tabular-nums text-text-muted">{offset(step.at - startedAt)}</span>
              </p>
            </li>
          );
        })}

        {end && <Capsule tone={end.tone} title={end.label} last />}

        <li ref={tail} aria-hidden className="h-px" />
      </ol>
    </div>
  );
}
