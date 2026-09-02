'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BotIcon,
  CircleCheckIcon,
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
 * A run as a CHAIN OF NODES: what woke it at the top, one node per tool call —
 * verb, what it touched, how long, whether it went well, with the result (or
 * the machine's own record) folded inside the node — and how it ended at the
 * bottom.
 *
 * The chain reads as a graph rather than a list: a hairline rail runs down the
 * left, each node hangs off it by an opaque round badge carrying the tool's
 * icon, and the badge is the only thing that carries the node's tone. The
 * model's own text sits beside the rail between nodes, as the reasoning that
 * led from one to the next, and the executor's notes as amber asides.
 *
 * Pure over its input: the same component renders a finished transcript and a
 * run in flight — `live` only decides whether the open node breathes and
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
  run_code: { verb: 'Ran code', Icon: CodeIcon },
  run_command: { verb: 'Ran', Icon: CodeIcon },
  open_page: { verb: 'Opened', Icon: GlobeIcon },
  run_agent: { verb: 'Started agent', Icon: BotIcon },
  create_node: { verb: 'Created', Icon: PlusIcon },
  link_nodes: { verb: 'Linked', Icon: WaypointsIcon },
};

/** What woke the run, as the chain's first node. */
export interface TriggerNode {
  /** 'scheduled' | 'interval' | 'manual' | 'event' | 'webhook' — decides the icon. */
  kind: string;
  label: string;
  events: NonNullable<RunInput['events']> | null;
}

/** How the run ended, as the chain's last node. Absent while it is still going. */
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

const RESULT_PREVIEW = 120;
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
    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 px-3 py-2 font-mono text-[12px] leading-5">
      {lines.map((l, i) => (
        <div key={i} className={MACHINE_TONE[l.tone]}>
          {l.text}
        </div>
      ))}
    </pre>
  );
}

type NodeTone = 'ok' | 'bad' | 'live' | 'muted';

/** The badge a node hangs off the rail by — opaque, so the rail passes behind it. */
const BADGE_TONE: Record<NodeTone, string> = {
  ok: 'border-border-default text-text-secondary',
  muted: 'border-border-default text-text-muted',
  bad: 'border-red-300 text-red-600',
  live: 'border-sky-400 text-sky-600 dot-pulse [--pulse-color:rgba(14,165,233,0.35)]',
};

const BOX_TONE: Record<NodeTone, string> = {
  ok: 'border-border-subtle',
  muted: 'border-border-subtle',
  bad: 'border-red-200',
  live: 'border-sky-200',
};

/**
 * One node on the chain: the badge on the rail, and the box beside it. The box
 * is opaque and hairline-bordered; the badge is what carries the tone, so a
 * chain of twenty steps stays one colour until something is live or wrong.
 */
function ChainNode({
  tone,
  Icon,
  title,
  detail,
  detailHref,
  right,
  children,
}: {
  tone: NodeTone;
  Icon: (props: { className?: string }) => React.ReactNode;
  title: string;
  detail?: string | null;
  detailHref?: string | null;
  right?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3">
      <span
        aria-hidden
        className={`relative z-10 mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full border bg-surface-1 ${BADGE_TONE[tone]}`}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className={`min-w-0 flex-1 rounded-lg border bg-surface-1 px-3 py-2 ${BOX_TONE[tone]}`}>
        <div className="flex items-baseline gap-2 text-[13px]">
          <span className={`shrink-0 font-medium ${tone === 'bad' ? 'text-red-600' : 'text-text-primary'}`}>{title}</span>
          {detail && (
            <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary" title={detail}>
              {detailHref ? (
                <Link className="hover:text-brand-dark-green hover:underline" href={detailHref}>
                  {detail}
                </Link>
              ) : (
                detail
              )}
            </span>
          )}
          {right && <span className="ml-auto shrink-0 tabular-nums text-[11px] text-text-muted">{right}</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

function ToolNode({ step, live, now }: { step: Step; live: boolean; now: number }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_VERB[step.tool ?? ''] ?? { verb: step.tool ?? 'Did', Icon: SparklesIcon };
  const running = live && step.result === undefined;
  const failed = stepFailed(step);
  const took = step.endedAt !== undefined ? step.endedAt - step.at : running ? now - step.at : null;
  const path = writtenPath(step);
  const result = step.result ?? '';
  const firstLine = result.split('\n')[0] ?? '';
  const preview = firstLine.length > RESULT_PREVIEW ? `${firstLine.slice(0, RESULT_PREVIEW)}…` : firstLine;
  const more = result.length > preview.length;
  const tone: NodeTone = running ? 'live' : failed ? 'bad' : 'ok';
  // The machine's record says more than the tool's one-line result, so a
  // machine step shows the terminal and folds the result away.
  const hasMachine = !!step.machine?.length;

  return (
    <ChainNode
      tone={tone}
      Icon={meta.Icon}
      title={meta.verb}
      detail={step.detail}
      detailHref={path ? hrefForNotePath(path, null) : null}
      right={took !== null ? duration(took) : null}
    >
      {hasMachine && <MachineRecord events={step.machine!} />}
      {result && !hasMachine && (
        <button
          type="button"
          className="mt-1 block max-w-full text-left font-mono text-[12px] leading-relaxed text-text-muted hover:text-text-secondary"
          onClick={() => more && setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <span className="whitespace-pre-wrap break-words">{result}</span> : <span className="block truncate">{preview}</span>}
          {more && <span className="ml-1 text-brand-dark-green">{open ? 'less' : 'more'}</span>}
        </button>
      )}
      {result && hasMachine && failed && <p className="mt-1 font-mono text-[12px] text-red-600">{preview}</p>}
      {running && !result && !hasMachine && <p className="mt-1 font-mono text-[12px] text-text-muted">working…</p>}
    </ChainNode>
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
  /** The chain's first node — what woke the run. Omitted, the chain starts at the first step. */
  trigger?: TriggerNode | null;
  /** The chain's last node — how it ended. Omitted while the run is going. */
  end?: EndNode | null;
  emptyText?: string;
  scroll?: boolean;
}) {
  const steps = useMemo(() => attachMachine(stepsOf(events), machine ?? []), [events, machine]);
  // A one-second clock only while something is open, so a running step's
  // duration counts up rather than sitting at the last flush.
  const [now, setNow] = useState(() => Date.now());
  const anyOpen = live && steps.some((s) => s.kind === 'tool' && s.result === undefined);
  useEffect(() => {
    if (!anyOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyOpen]);

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
  const triggerTone: NodeTone = live && steps.length === 0 ? 'live' : 'muted';

  return (
    <div ref={box} className={scroll ? 'max-h-[34rem] overflow-y-auto pr-1' : ''}>
      <ol className="relative flex flex-col gap-2">
        {/* The rail: one hairline down the badges' centres. The badges are
            opaque, so what shows between them IS the connector. */}
        <span aria-hidden className="absolute bottom-6 left-[13.5px] top-6 w-px bg-border-default" />

        {trigger && (
          <ChainNode tone={triggerTone} Icon={TriggerIcon} title={trigger.label}>
            {trigger.events && trigger.events.length > 0 && (
              <ol className="mt-1 flex flex-col gap-0.5 font-mono text-[12px]">
                {trigger.events.slice(0, TRIGGER_EVENTS_SHOWN).map((e, i) => (
                  <li key={i} className="truncate" title={`${e.source} — ${e.summary}`}>
                    <span className="text-sky-700">{e.kind}</span> {e.source} <span className="text-text-muted">— {e.summary}</span>
                  </li>
                ))}
                {extraEvents > 0 && <li className="text-text-muted">+{extraEvents} more</li>}
              </ol>
            )}
          </ChainNode>
        )}

        {steps.map((step, i) => {
          if (step.kind === 'tool') return <ToolNode key={i} step={step} live={live} now={now} />;
          if (step.kind === 'thought') {
            // The model's words are the connector's annotation, not a node:
            // they sit beside the rail, between the step that ended and the
            // one they led to.
            return (
              <li key={i} className="py-0.5 pl-10">
                <p className="whitespace-pre-wrap break-words text-[13px] text-text-secondary">{step.text}</p>
              </li>
            );
          }
          return (
            <li key={i} className="py-0.5 pl-10">
              <p className="text-[12px] text-amber-700">
                <TriangleAlertIcon className="relative top-[2px] mr-1.5 inline h-3 w-3" />
                {step.text}
                <span className="ml-2 tabular-nums text-text-muted">{offset(step.at - startedAt)}</span>
              </p>
            </li>
          );
        })}

        {end && <ChainNode tone={end.tone} Icon={end.tone === 'bad' ? XIcon : CircleCheckIcon} title={end.label} />}

        <li ref={tail} aria-hidden className="h-px" />
      </ol>
    </div>
  );
}
