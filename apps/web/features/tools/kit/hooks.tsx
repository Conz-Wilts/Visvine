/**
 * The React face of the bridge — what a Tool author actually touches.
 *
 * `useVisvine()` is deliberately shaped like an SDK and not like a message
 * bus: `visvine.context.read(path)` rather than `call('context.read', {path})`,
 * so the method table stays an implementation detail and a typo is a type
 * error. Everything still goes out through the one client, so there is exactly
 * one place where a Tool can reach Visvine.
 *
 * Kept to `react` imports only — this file ships inside the sandbox bundle.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  ContextEntry,
  ContextHit,
  ContextNote,
  ToolDegraded,
  ToolInitMessage,
  ToolInstallInfo,
  ToolSubject,
  ToolViewer,
} from '@/lib/tools/protocol';
import type { BridgeClient } from './client';

/** Everything a Tool can do. Every method rejects with a `BridgeCallError`. */
export interface VisvineApi {
  context: {
    /** Notes inside the Tool's declared read perimeter, newest first. */
    list(glob?: string): Promise<ContextEntry[]>;
    read(path: string): Promise<ContextNote>;
    search(query: string, k?: number): Promise<ContextHit[]>;
    write(path: string, content: string): Promise<{ path: string }>;
    append(path: string, text: string): Promise<{ path: string }>;
  };
  connectors: {
    /** Run `code` inside a declared connector's isolate and return its result. */
    call<T = unknown>(name: string, code: string): Promise<T>;
  };
  agents: {
    run(name: string): Promise<{ runId: string }>;
  };
  data: {
    /** Call a handler this Tool exported from `data.js`. */
    call<T = unknown>(fn: string, args?: unknown): Promise<T>;
  };
  state: {
    /** Per-install key/value store. There is no `localStorage` in the sandbox. */
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<null>;
  };
  /** What this Tool is being shown about, or null on its own page. */
  subject: ToolSubject | null;
  viewer: ToolViewer;
  install: ToolInstallInfo;
  /** Non-null when the space is missing something the Tool declared. */
  degraded: ToolDegraded | null;
  /** Ask Visvine to navigate. In-app paths only; the host refuses the rest. */
  navigate(path: string): void;
}

interface VisvineContextValue {
  api: VisvineApi;
  theme: Record<string, string>;
}

const VisvineContext = createContext<VisvineContextValue | null>(null);

function useVisvineContext(): VisvineContextValue {
  const value = useContext(VisvineContext);
  if (!value) throw new Error('useVisvine must be used inside <VisvineProvider> — the runtime mounts it for you.');
  return value;
}

/**
 * Wraps the Tool's own component. The runtime mounts this once the handshake
 * has landed, so `init` is always a real payload and nothing below ever has to
 * render a "connecting" state.
 */
export function VisvineProvider({
  client,
  init,
  children,
}: {
  client: BridgeClient;
  init: ToolInitMessage;
  /** Optional so the runtime can mount this with `createElement` rest args. */
  children?: ReactNode;
}) {
  const [subject, setSubject] = useState<ToolSubject | null>(init.subject);
  const [theme, setTheme] = useState<Record<string, string>>(init.theme);

  useEffect(() => {
    const offSubject = client.onSubject(setSubject);
    const offTheme = client.onTheme(setTheme);
    return () => {
      offSubject();
      offTheme();
    };
  }, [client]);

  const api = useMemo<VisvineApi>(
    () => ({
      context: {
        list: (glob) => client.call('context.list', glob === undefined ? {} : { glob }),
        read: (path) => client.call('context.read', { path }),
        search: (query, k) => client.call('context.search', k === undefined ? { query } : { query, k }),
        write: (path, content) => client.call('context.write', { path, content }),
        append: (path, text) => client.call('context.append', { path, text }),
      },
      connectors: {
        call: <T,>(name: string, code: string) => client.call('connectors.call', { name, code }) as Promise<T>,
      },
      agents: {
        run: (name) => client.call('agents.run', { name }),
      },
      data: {
        call: <T,>(fn: string, args?: unknown) => client.call('data.call', { fn, args: args ?? null }) as Promise<T>,
      },
      state: {
        get: <T,>(key: string) => client.call('state.get', { key }) as Promise<T | null>,
        set: (key, value) => client.call('state.set', { key, value }),
      },
      subject,
      viewer: init.viewer,
      install: init.install,
      degraded: init.degraded,
      navigate: (path) => client.navigate(path),
    }),
    [client, subject, init.viewer, init.install, init.degraded],
  );

  return <VisvineContext.Provider value={{ api, theme }}>{children}</VisvineContext.Provider>;
}

/** The Tool's handle on Visvine. */
export function useVisvine(): VisvineApi {
  return useVisvineContext().api;
}

/** What this Tool is being shown about, kept current as the host re-points it. */
export function useSubject(): ToolSubject | null {
  return useVisvineContext().api.subject;
}

/**
 * The theme map the host sent, as raw CSS custom properties. The runtime has
 * already applied these to `:root`, so styling with `var(--vv-accent)` is the
 * normal path — read this only when a value is needed in JS (a chart colour).
 */
export function useTheme(): Record<string, string> {
  return useVisvineContext().theme;
}

export interface QueryResult<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Re-run the query — after a write, say. */
  reload: () => void;
}

/**
 * The small async helper every Tool ends up writing anyway: run `fn` when
 * `deps` change, ignore the result of a run that has been superseded, and hand
 * back a reload for after a write.
 */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[]): QueryResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // `fn` is a fresh closure on every render; `deps` is what the author says
  // actually changed, so the effect keys off deps and reads the latest fn.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let live = true;
    setLoading(true);
    fnRef.current().then(
      (value) => {
        if (!live) return;
        setData(value);
        setError(null);
        setLoading(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the dep list is the caller's
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, error, loading, reload };
}
