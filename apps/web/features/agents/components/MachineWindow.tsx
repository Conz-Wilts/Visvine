'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Skeleton } from '@/components/ui';
import { fetchJson } from '@/lib/fetchJson';

/**
 * What the agent's machine is doing, and what it did.
 *
 * Two halves of one record. The socket shows events as they happen and exists
 * only while someone is looking; the timeline is stored and answers the same
 * question after the fact, which is why a run nobody watched is still
 * reviewable. Watching is admin-only for the same reason running a command is:
 * a machine holds the space's reach, and its terminal shows what the agent is
 * doing with it.
 *
 * The browser never holds the edge's service token. It asks for a ticket good
 * for sixty seconds and one machine, and spends it opening the socket.
 */

type EventKind =
  | 'boot'
  | 'wake'
  | 'exec'
  | 'output'
  | 'exit'
  | 'sleep'
  | 'error'
  | 'egress_denied'
  | 'takeover'
  | 'release'
  | 'watching'
  | 'frame';

/** The display the machine draws on. Input is sent in its coordinates, not the page's. */
const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 800;

interface VmEvent {
  id?: string;
  seq: number;
  kind: EventKind;
  at: string;
  payload: Record<string, unknown>;
}

interface Refusal {
  id: string;
  method: string;
  host: string;
  path: string;
  verdict: string;
  reason: string | null;
  at: string;
}

interface MachineState {
  state: string;
  instanceType: string;
  policyHash: string | null;
  lastActiveAt: string | null;
  workspaceKey: string;
}

interface TimelineResponse {
  machine: MachineState | null;
  events: VmEvent[];
  refusals: Refusal[];
}

const KIND_LABEL: Record<EventKind, string> = {
  boot: 'started',
  wake: 'woke',
  exec: 'ran',
  output: 'output',
  exit: 'finished',
  sleep: 'slept',
  error: 'error',
  egress_denied: 'refused',
  takeover: 'took control',
  release: 'gave control back',
  watching: 'watching',
  frame: 'frame',
};

function describe(event: VmEvent): string {
  const p = event.payload ?? {};
  switch (event.kind) {
    case 'exec':
      return Array.isArray(p.cmd) ? (p.cmd as string[]).join(' ') : '';
    case 'output':
      return typeof p.text === 'string' ? p.text.trimEnd() : '';
    case 'exit':
      return p.timedOut ? 'timed out' : `exit ${String(p.exitCode ?? '?')}`;
    case 'boot':
      return `${String(p.instanceType ?? '')}${p.workspaceRestored ? ' · workspace restored' : ''}`;
    case 'error':
      return typeof p.message === 'string' ? p.message : '';
    default:
      return '';
  }
}

function clock(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

export default function MachineWindow({ spaceId, agentName }: { spaceId: string; agentName: string }) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [live, setLive] = useState<VmEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [watching, setWatching] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [inControl, setInControl] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLImageElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await fetchJson<TimelineResponse>(
        `/api/communities/${spaceId}/vm/timeline?agent=${encodeURIComponent(agentName)}`,
      );
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the machine');
    } finally {
      setLoading(false);
    }
  }, [spaceId, agentName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The socket is closed on the way out. A watcher that has navigated away
  // still holds the machine's Durable Object awake, which is a real cost.
  useEffect(() => () => socketRef.current?.close(), []);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [live]);

  const watch = async () => {
    setError(null);
    try {
      const { url } = await fetchJson<{ url: string }>(
        `/api/communities/${spaceId}/vm/watch?agent=${encodeURIComponent(agentName)}`,
        { method: 'POST' },
      );
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => setWatching(true);
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as VmEvent;
          // Frames are the screen, not the record: they replace each other and
          // are never kept.
          if (event.kind === 'frame') setFrame(String(event.payload.jpeg ?? ''));
          else setLive((prev) => [...prev.slice(-500), event]);
        } catch {
          // A message we cannot read is not worth breaking the window over.
        }
      };
      socket.onclose = () => {
        setWatching(false);
        // What was live is now history; the stored timeline has it too.
        void reload();
      };
      socket.onerror = () => setError('The connection to the machine dropped.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open the machine');
    }
  };

  const stopWatching = () => {
    socketRef.current?.close();
    socketRef.current = null;
    setWatching(false);
    setInControl(false);
    setFrame(null);
  };

  const send = (message: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  };

  /**
   * Take the keyboard, or give it back. The agent keeps running either way —
   * what changes is that the machine will now accept input from this window,
   * and that the timeline records who held it and for how long.
   */
  const toggleControl = () => {
    if (inControl) {
      send({ kind: 'release' });
      setInControl(false);
    } else {
      send({ kind: 'takeover' });
      setInControl(true);
    }
  };

  /** Page coordinates are not the machine's; the image may be any size on screen. */
  const atScreen = (clientX: number, clientY: number) => {
    const box = screenRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return { x: 0, y: 0 };
    return {
      x: Math.round(((clientX - box.left) / box.width) * SCREEN_WIDTH),
      y: Math.round(((clientY - box.top) / box.height) * SCREEN_HEIGHT),
    };
  };

  if (loading) return <Skeleton className="h-32 w-full rounded-lg" />;

  const machine = data?.machine ?? null;
  const stored = data?.events ?? [];
  const refusals = data?.refusals ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-sm text-text-secondary">
          {machine
            ? `Machine ${machine.state} · ${machine.instanceType} · workspace ${machine.workspaceKey}`
            : 'No machine yet — one is leased the first time this agent runs a command.'}
        </p>
        {machine &&
          (watching ? (
            <Button variant="ghost" size="sm" onClick={stopWatching}>
              Stop watching
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={watch}>
              Watch
            </Button>
          ))}
      </div>

      {error && <Alert>{error}</Alert>}

      {watching && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[13px] text-text-secondary">
              {inControl
                ? 'You have the keyboard. Click and type into the screen; the agent is still running.'
                : 'Watching. Take control to click and type on the machine yourself.'}
            </p>
            <Button variant={inControl ? 'brand' : 'ghost'} size="sm" onClick={toggleControl}>
              {inControl ? 'Give control back' : 'Take control'}
            </Button>
          </div>
          {frame ? (
            // A JPEG frame off a socket, not an asset: next/image would want a
            // loader and a URL, and this is neither.
            <img
              ref={screenRef}
              src={`data:image/jpeg;base64,${frame}`}
              alt="The agent's screen"
              className={`w-full rounded-md border border-border-subtle bg-black ${inControl ? 'cursor-crosshair' : ''}`}
              draggable={false}
              tabIndex={inControl ? 0 : -1}
              onClick={(event) => {
                if (!inControl) return;
                send({ kind: 'input', event: { kind: 'click', ...atScreen(event.clientX, event.clientY) } });
              }}
              onKeyDown={(event) => {
                if (!inControl) return;
                event.preventDefault();
                // A printable character is typed; anything else is a named key,
                // which is the only vocabulary the machine accepts.
                if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
                  send({ kind: 'input', event: { kind: 'type', text: event.key } });
                } else {
                  const named: Record<string, string> = {
                    Enter: 'Return',
                    Backspace: 'BackSpace',
                    Tab: 'Tab',
                    Escape: 'Escape',
                    ArrowUp: 'Up',
                    ArrowDown: 'Down',
                    ArrowLeft: 'Left',
                    ArrowRight: 'Right',
                  };
                  const key = named[event.key];
                  if (key) send({ kind: 'input', event: { kind: 'key', key } });
                }
              }}
            />
          ) : (
            <p className="rounded-md border border-border-subtle bg-surface-2 p-6 text-center text-[13px] text-text-tertiary">
              No screen yet — the machine has no browser open.
            </p>
          )}
        </div>
      )}

      {watching && (
        <div
          ref={tailRef}
          className="max-h-64 overflow-y-auto rounded-md border border-border-subtle bg-surface-2 p-3 font-mono text-[12px] leading-5 text-text-secondary"
        >
          {live.length === 0 ? (
            <p className="text-text-tertiary">Connected. Nothing has happened yet.</p>
          ) : (
            live.map((event) => (
              <div key={`${event.seq}-${event.at}`} className="whitespace-pre-wrap break-words">
                <span className="text-text-tertiary">{clock(event.at)} </span>
                <span className="text-text-primary">{KIND_LABEL[event.kind] ?? event.kind}</span>
                {describe(event) && <span> {describe(event)}</span>}
              </div>
            ))
          )}
        </div>
      )}

      <div className="flex flex-col">
        <p className="mb-2 text-[13px] font-semibold text-text-primary">Timeline</p>
        {stored.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">Nothing recorded yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {stored.map((event) => (
              <li key={event.id ?? `${event.seq}`} className="flex gap-3 py-1.5 text-[13px]">
                <span className="shrink-0 font-mono text-text-tertiary">{clock(event.at)}</span>
                <span className="shrink-0 text-text-primary">{KIND_LABEL[event.kind] ?? event.kind}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-text-secondary">{describe(event)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {refusals.length > 0 && (
        <div className="flex flex-col">
          <p className="mb-2 text-[13px] font-semibold text-text-primary">Refused</p>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {refusals.map((refusal) => (
              <li key={refusal.id} className="flex gap-3 py-1.5 text-[13px]">
                <span className="shrink-0 font-mono text-text-tertiary">{clock(refusal.at)}</span>
                <span className="min-w-0 flex-1 truncate text-text-secondary">
                  {refusal.method} {refusal.host}
                  {refusal.reason ? ` — ${refusal.reason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
