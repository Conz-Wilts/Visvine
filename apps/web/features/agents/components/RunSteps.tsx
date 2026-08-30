'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BellIcon,
  BotIcon,
  CircleQuestionMarkIcon,
  CodeIcon,
  FileTextIcon,
  GlobeIcon,
  ListIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from '@/features/shared/icons';
import type { AgentRunEvent } from '@/lib/agents/runs';
import { hrefForNotePath } from '@/lib/notes/entities';
import { TONE_DOT } from '../lib/rowState';

/**
 * A run's trace as STEPS: each tool call and its result folded into one row
 * with a verb, what it touched, how long it took and whether it went well —
 * the model's own text between them as thoughts, the executor's notes as
 * asides. The raw events (lib/agents/runs.ts#AgentRunEvent) are a flat log
 * the executor flushes every couple of seconds; this is the shape a person
 * reads, live while the run is on and after the fact in the history.
 *
 * Pure over its input: the same component renders a finished transcript and a
 * run in flight — `live` only decides whether the last open step breathes and
 * whether the view follows the tail.
 */

export interface Step {
  kind: 'tool' | 'thought' | 'note';
  at: number;
  /** The tool name for a tool step. */
  tool?: string;
  /** What the call was about (path, query, recipient…). */
  detail?: string;
  /** The tool's result; undefined while it is still running. */
  result?: string;
  /** When the result arrived. */
  endedAt?: number;
  /** A thought's or note's text. */
  text?: string;
}

/** Fold the flat trace into steps: a tool event opens one, its result closes it. */
export function stepsOf(events: AgentRunEvent[]): Step[] {
  const steps: Step[] = [];
  let open: Step | null = null;
  for (const e of events) {
    if (e.type === 'tool') {
      open = { kind: 'tool', at: e.at, tool: e.tool, detail: e.detail };
      steps.push(open);
    } else if (e.type === 'tool_result') {
      if (open && open.tool === e.tool && open.result === undefined) {
        open.result = e.text;
        open.endedAt = e.at;
      } else {
        steps.push({ kind: 'tool', at: e.at, tool: e.tool, detail: '', result: e.text, endedAt: e.at });
      }
      open = null;
    } else if (e.type === 'assistant') {
      steps.push({ kind: 'thought', at: e.at, text: e.text });
      open = null;
    } else {
      steps.push({ kind: 'note', at: e.at, text: e.text });
    }
  }
  return steps;
}

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
  notify: { verb: 'Notified', Icon: BellIcon },
  ask_human: { verb: 'Asked', Icon: CircleQuestionMarkIcon },
  run_agent: { verb: 'Started agent', Icon: BotIcon },
  create_node: { verb: 'Created', Icon: PlusIcon },
  link_nodes: { verb: 'Linked', Icon: WaypointsIcon },
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

const RESULT_PREVIEW = 160;

function ToolStep({ step, live, now }: { step: Step; live: boolean; now: number }) {
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
  const tone = running ? 'live' : failed ? 'bad' : 'ok';
  const { Icon } = meta;

  return (
    <li className="relative pl-6">
      <span className={`absolute left-0 top-[7px] h-2 w-2 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
      <div className="flex items-baseline gap-2 text-[13px]">
        <Icon className="relative top-[2px] h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className={`font-medium ${failed ? 'text-red-600' : 'text-text-primary'}`}>{meta.verb}</span>
        {step.detail && (
          <span className="min-w-0 truncate font-mono text-[12px] text-text-secondary" title={step.detail}>
            {path ? (
              <Link className="hover:text-brand-dark-green hover:underline" href={hrefForNotePath(path, null)}>
                {step.detail}
              </Link>
            ) : (
              step.detail
            )}
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-[11px] text-text-muted">
          {took !== null ? duration(took) : ''}
        </span>
      </div>
      {result && (
        <button
          type="button"
          className="mt-0.5 block max-w-full text-left font-mono text-[12px] leading-relaxed text-text-muted hover:text-text-secondary"
          onClick={() => more && setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? <span className="whitespace-pre-wrap break-words">{result}</span> : <span className="block truncate">{preview}</span>}
          {more && !open && <span className="ml-1 text-brand-dark-green">more</span>}
          {open && <span className="ml-1 text-brand-dark-green">less</span>}
        </button>
      )}
      {running && !result && <p className="mt-0.5 font-mono text-[12px] text-text-muted">working…</p>}
    </li>
  );
}

export default function RunSteps({
  events,
  live,
  startedAt,
  /** Words for an empty trace — "Starting…" while live, "Nothing recorded." after. */
  emptyText,
}: {
  events: AgentRunEvent[];
  live: boolean;
  startedAt: number;
  emptyText?: string;
}) {
  const steps = useMemo(() => stepsOf(events), [events]);
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
  const box = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    if (!live || !box.current || !tail.current) return;
    const el = box.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) tail.current.scrollIntoView({ block: 'end' });
  }, [live, steps.length]);

  if (steps.length === 0) {
    return <p className="text-[13px] text-text-muted">{emptyText ?? (live ? 'Starting…' : 'Nothing recorded.')}</p>;
  }

  return (
    <ol ref={box} className={`flex flex-col gap-2.5 border-l border-border-subtle pl-3 ${live ? 'max-h-[28rem] overflow-y-auto' : ''}`}>
      {steps.map((step, i) => {
        if (step.kind === 'tool') return <ToolStep key={i} step={step} live={live} now={now} />;
        if (step.kind === 'thought') {
          return (
            <li key={i} className="relative pl-6">
              <span className="absolute left-0 top-[6px] font-mono text-[12px] text-brand-dark-green" aria-hidden>
                ›
              </span>
              <p className="whitespace-pre-wrap break-words text-[13px] text-text-primary">{step.text}</p>
            </li>
          );
        }
        return (
          <li key={i} className="relative pl-6">
            <TriangleAlertIcon className="absolute left-0 top-[4px] h-3 w-3 text-amber-600" />
            <p className="text-[12px] text-amber-700">
              {step.text}
              <span className="ml-2 tabular-nums text-text-muted">{offset(step.at - startedAt)}</span>
            </p>
          </li>
        );
      })}
      <li ref={tail} aria-hidden className="h-px" />
    </ol>
  );
}
