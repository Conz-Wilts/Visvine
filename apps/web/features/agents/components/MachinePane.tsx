'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import { Alert, Button } from '@visvine/ui';
import { fetchJson } from '@/lib/fetchJson';
import type { MachineEvent } from '@/lib/agents/shared/trace';
import { fmtAgo } from '../lib/rowState';

/**
 * The agent's machine, beside its run: the screen and the terminal, live.
 *
 * Two halves of one record. The socket shows what happens as it happens and
 * exists only while someone is looking; the timeline is stored and reads back
 * per run under the steps (RunSteps), which is why a run nobody watched is
 * still reviewable. Watching is admin-only for the same reason running a
 * command is: a machine holds the space's reach, and its terminal shows what
 * the agent is doing with it.
 *
 * The browser never holds the edge's service token. It asks for a ticket good
 * for sixty seconds and one machine, and spends it opening the socket.
 * `autoWatch` opens it without a click — the window does that while a run is
 * on, because a live run is the moment the screen is worth seeing.
 */

/** The display the machine draws on. Input is sent in its coordinates, not the page's. */
const SCREEN_WIDTH = 1280;
const SCREEN_HEIGHT = 800;

interface MachineState {
  state: string;
  instanceType: string;
  lastActiveAt: string | null;
  workspaceKey: string;
}

interface TimelineResponse {
  machine: MachineState | null;
  events: (MachineEvent & { id?: string })[];
}

const KIND_LABEL: Record<string, string> = {
  boot: 'started',
  wake: 'woke',
  exec: 'ran',
  output: '',
  exit: 'finished',
  sleep: 'slept',
  error: 'error',
  egress_denied: 'refused',
  takeover: 'took control',
  release: 'gave control back',
  browse: 'opened',
  watching: 'watching',
};

function describe(event: MachineEvent): string {
  const p = event.payload ?? {};
  switch (event.kind) {
    case 'exec':
      return `$ ${Array.isArray(p.cmd) ? (p.cmd as string[]).join(' ') : ''}`;
    case 'output':
      return typeof p.text === 'string' ? p.text.trimEnd() : '';
    case 'exit':
      return p.timedOut ? 'timed out' : `exit ${String(p.exitCode ?? '?')}`;
    case 'boot':
      return `${String(p.instanceType ?? '')}${p.workspaceRestored ? ' · workspace restored' : ''}`;
    case 'error':
      return typeof p.message === 'string' ? p.message : '';
    case 'egress_denied':
      return `${String(p.method ?? '')} ${String(p.host ?? '')}${p.reason ? ` — ${String(p.reason)}` : ''}`.trim();
    case 'browse':
      return String(p.url ?? '');
    default:
      return '';
  }
}

function clock(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

const STATE_LABEL: Record<string, string> = {
  provisioning: 'starting',
  running: 'awake',
  asleep: 'asleep',
  reaping: 'shutting down',
  unavailable: 'unavailable',
  dead: 'gone',
};

const NAMED_KEYS: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

export default function MachinePane({
  spaceId,
  agentName,
  autoWatch,
}: {
  spaceId: string;
  agentName: string;
  /** Open the socket as soon as there is a machine — while a run is on. */
  autoWatch: boolean;
}) {
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [live, setLive] = useState<MachineEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [frame, setFrame] = useState<string | null>(null);
  const [inControl, setInControl] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const tailRef = useRef<HTMLDivElement | null>(null);
  const screenRef = useRef<HTMLImageElement | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await fetchJson<TimelineResponse>(`/api/spaces/${spaceId}/vm/timeline?agent=${encodeURIComponent(agentName)}&limit=60`);
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the machine');
    }
  }, [spaceId, agentName]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // While a run is on and nobody is attached, the stored timeline is the only
  // view — keep it moving.
  const visible = usePageVisible();
  useEffect(() => {
    if (!autoWatch || watching || !visible) return;
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [autoWatch, watching, visible, reload]);

  const stopWatching = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setWatching(false);
    setInControl(false);
    setFrame(null);
  }, []);

  // The socket is closed on the way out. A watcher that has navigated away
  // still holds the machine's Durable Object awake, which is a real cost.
  useEffect(() => () => socketRef.current?.close(), []);

  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight });
  }, [live]);

  const watch = useCallback(async () => {
    if (socketRef.current) return;
    setError(null);
    setConnecting(true);
    try {
      const { url } = await fetchJson<{ url: string }>(`/api/spaces/${spaceId}/vm/watch?agent=${encodeURIComponent(agentName)}`, {
        method: 'POST',
      });
      const socket = new WebSocket(url);
      socketRef.current = socket;
      socket.onopen = () => {
        setWatching(true);
        setConnecting(false);
      };
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data as string) as MachineEvent;
          // Frames are the screen, not the record: they replace each other and
          // are never kept.
          if (event.kind === 'frame') setFrame(String(event.payload.jpeg ?? ''));
          else setLive((prev) => [...prev.slice(-500), event]);
        } catch {
          // A message we cannot read is not worth breaking the window over.
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        setWatching(false);
        setConnecting(false);
        setInControl(false);
        setFrame(null);
        // What was live is now history; the stored timeline has it too.
        void reload();
      };
      socket.onerror = () => setError('The connection to the machine dropped.');
    } catch (e) {
      setConnecting(false);
      setError(e instanceof Error ? e.message : 'Could not open the machine');
    }
  }, [spaceId, agentName, reload]);

  const machine = data?.machine ?? null;
  useEffect(() => {
    if (autoWatch && machine && !watching && !connecting && !socketRef.current) void watch();
  }, [autoWatch, machine, watching, connecting, watch]);

  const send = (message: Record<string, unknown>) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
  };

  /**
   * Take the keyboard, or give it back. The agent keeps running either way —
   * what changes is that the machine will now accept input from this window,
   * and that the timeline records who held it and for how long.
   */
  const toggleControl = () => {
    send({ kind: inControl ? 'release' : 'takeover' });
    setInControl((c) => !c);
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

  const stored = data?.events ?? [];
  const terminal = watching ? live : stored.slice().reverse().filter((e) => e.kind !== 'output' || describe(e));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[13px] text-fg-secondary">
          {machine ? (
            <>
              <span className="font-medium text-fg">Machine</span> {STATE_LABEL[machine.state] ?? machine.state} · {machine.instanceType}
              {machine.lastActiveAt ? ` · active ${fmtAgo(machine.lastActiveAt)}` : ''}
            </>
          ) : (
            <>
              <span className="font-medium text-fg">Machine</span> none yet — leased the first time this agent runs a command
            </>
          )}
        </p>
        {machine &&
          (watching ? (
            <Button variant="ghost" size="sm" onClick={stopWatching}>
              Stop watching
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={watch} disabled={connecting}>
              {connecting ? 'Connecting…' : 'Watch live'}
            </Button>
          ))}
      </div>

      {error && (
        <Alert inline variant="warning">
          {error}
        </Alert>
      )}

      {watching && (
        <div className="flex flex-col gap-2">
          {frame ? (
            // A JPEG frame off a socket, not an asset: next/image would want a
            // loader and a URL, and this is neither.
            <img
              ref={screenRef}
              src={`data:image/jpeg;base64,${frame}`}
              alt="The agent's screen"
              className={`w-full rounded-md border border-line-subtle bg-black ${inControl ? 'cursor-crosshair ring-2 ring-accent' : ''}`}
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
                  const key = NAMED_KEYS[event.key];
                  if (key) send({ kind: 'input', event: { kind: 'key', key } });
                }
              }}
            />
          ) : (
            <p className="rounded-md border border-line-subtle bg-surface-subtle px-4 py-8 text-center text-[13px] text-fg-muted">
              No screen — the machine has no browser open. The terminal below is live.
            </p>
          )}
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[12px] text-fg-muted">
              {inControl ? 'You have the keyboard — click and type on the screen. The agent keeps running.' : 'Take control to click and type on the machine yourself.'}
            </p>
            {frame && (
              <Button variant={inControl ? 'brand' : 'neutral'} size="sm" onClick={toggleControl}>
                {inControl ? 'Give control back' : 'Take control'}
              </Button>
            )}
          </div>
        </div>
      )}

      <div
        ref={tailRef}
        className="max-h-72 overflow-y-auto rounded-md bg-surface-subtle px-3 py-2 font-mono text-[12px] leading-5 text-fg-secondary"
        aria-live="polite"
      >
        {terminal.length === 0 ? (
          <p className="text-fg-muted">{watching ? 'Connected. Nothing has happened yet.' : machine ? 'Nothing recorded yet.' : 'The terminal appears here once the machine exists.'}</p>
        ) : (
          terminal.map((event, i) => {
            const text = describe(event);
            const label = KIND_LABEL[event.kind] ?? event.kind;
            const bad = event.kind === 'error' || event.kind === 'egress_denied' || (event.kind === 'exit' && Number(event.payload?.exitCode) !== 0);
            return (
              <div key={`${event.seq}-${event.at}-${i}`} className={`whitespace-pre-wrap break-words ${bad ? 'text-danger' : event.kind === 'output' ? '' : 'text-fg'}`}>
                <span className="text-fg-muted">{clock(event.at)} </span>
                {label && event.kind !== 'exec' && <span className={event.kind === 'output' ? '' : 'italic'}>{label} </span>}
                {text}
              </div>
            );
          })
        )}
      </div>

      {!watching && stored.length > 0 && (
        <button
          type="button"
          className="self-start text-[12px] text-fg-muted hover:text-fg hover:underline"
          onClick={() => setHistoryOpen((o) => !o)}
        >
          {historyOpen ? 'Showing' : 'Show'} the last {stored.length} machine events{historyOpen ? '' : ' …'}
        </button>
      )}
      {!watching && historyOpen && (
        <ul className="flex flex-col divide-y divide-line-subtle">
          {stored.map((event) => (
            <li key={event.id ?? `${event.seq}`} className="flex gap-3 py-1 text-[12px]">
              <span className="shrink-0 font-mono text-fg-muted">{clock(event.at)}</span>
              <span className="shrink-0 text-fg">{KIND_LABEL[event.kind] || event.kind}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-fg-secondary">{describe(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
