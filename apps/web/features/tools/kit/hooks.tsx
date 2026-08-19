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
  ContextPage,
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
    /** Notes inside the Tool's declared read perimeter, path order, capped at one page. */
    list(glob?: string): Promise<ContextEntry[]>;
    /** One page of `list`; pass the previous `nextCursor` for the next. */
    listPage(glob?: string, cursor?: string | null): Promise<ContextPage<ContextEntry>>;
    read(path: string): Promise<ContextNote>;
    search(query: string, k?: number): Promise<ContextHit[]>;
    /** One page of `search`; `k` is the page size. */
    searchPage(query: string, opts?: { k?: number; cursor?: string | null }): Promise<ContextPage<ContextHit>>;
    write(path: string, content: string): Promise<{ path: string }>;
    append(path: string, text: string): Promise<{ path: string }>;
  };
  connectors: {
    /**
     * Run a declared connector: `code` inside its isolate, or one of its named
     * actions (`{ action, args }`) — and return the result.
     */
    call<T = unknown>(name: string, codeOrOpts: string | { action: string; args?: unknown } | { code: string }): Promise<T>;
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
  client: BridgeClient;
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
        list: (glob) => client.call('context.list', glob === undefined ? {} : { glob }) as Promise<ContextEntry[]>,
        listPage: (glob, cursor) =>
          client.call('context.list', {
            page: true,
            ...(glob === undefined ? {} : { glob }),
            ...(cursor ? { cursor } : {}),
          }) as Promise<ContextPage<ContextEntry>>,
        read: (path) => client.call('context.read', { path }),
        search: (query, k) =>
          client.call('context.search', k === undefined ? { query } : { query, k }) as Promise<ContextHit[]>,
        searchPage: (query, opts) =>
          client.call('context.search', {
            query,
            page: true,
            ...(opts?.k === undefined ? {} : { k: opts.k }),
            ...(opts?.cursor ? { cursor: opts.cursor } : {}),
          }) as Promise<ContextPage<ContextHit>>,
        write: (path, content) => client.call('context.write', { path, content }),
        append: (path, text) => client.call('context.append', { path, text }),
      },
      connectors: {
        call: <T,>(name: string, codeOrOpts: string | { action: string; args?: unknown } | { code: string }) =>
          client.call('connectors.call', {
            name,
            ...(typeof codeOrOpts === 'string' ? { code: codeOrOpts } : codeOrOpts),
          }) as Promise<T>,
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

  const value = useMemo(() => ({ api, theme, client }), [api, theme, client]);
  return <VisvineContext.Provider value={value}>{children}</VisvineContext.Provider>;
}

/** The Tool's handle on Visvine. */
export function useVisvine(): VisvineApi {
  return useVisvineContext().api;
}

/**
 * The same, or null outside a provider. Internal — for kit components (the
 * Markdown link handler) that should degrade rather than throw when rendered
 * somewhere unexpected. Not exported from the kit's index.
 */
export function useVisvineMaybe(): VisvineApi | null {
  return useContext(VisvineContext)?.api ?? null;
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

// ── live data ──

/**
 * A minimal glob for change matching, kept in step with the server's rules
 * for the shapes a Tool actually writes: `**` spans folders, `*` one segment,
 * `?` one character. Anything else is literal.
 */
function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` also matches zero folders.
        const slash = glob[i + 2] === '/';
        out += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(out + '$');
}

/** Does any of `paths` match any of `patterns`? An empty pattern list matches everything. */
export function pathsMatch(patterns: string[] | undefined, paths: string[]): boolean {
  if (!patterns || patterns.length === 0) return true;
  const res = patterns.map(globToRegExp);
  return paths.some((path) => res.some((re) => re.test(path)));
}

export interface LiveQueryOptions {
  /**
   * Only reload when a changed path matches one of these globs (`deals/**`,
   * `people/*.md`). Omit to reload on any change inside the Tool's perimeter.
   */
  paths?: string[];
  /** Poll interval in ms as the fallback for a missed event; 0 disables. Default 30s. */
  pollMs?: number;
}

/** The poll that catches what the change stream missed. */
export const LIVE_QUERY_POLL_MS = 30_000;

/**
 * `useQuery` that re-runs itself when the notes it depends on change.
 *
 * Two triggers: a `visvine:changed` from the host naming a path that matches
 * `paths` (or any path when `paths` is omitted), and a timer every `pollMs`
 * — the change stream is best-effort and per-server-process, so the poll is
 * what makes "eventually current" a promise rather than a hope. Reloads
 * triggered this way do not flip `loading` back to true, so the UI does not
 * flash; `refreshing` says one is in flight.
 */
export function useLiveQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: LiveQueryOptions = {}): QueryResult<T> & { refreshing: boolean } {
  const { client } = useVisvineContext();
  const { paths, pollMs = LIVE_QUERY_POLL_MS } = opts;
  const base = useQuery(fn, deps);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const patternsKey = JSON.stringify(paths ?? null);

  // The base query's answer wins whenever it changes (mount, deps, reload()).
  useEffect(() => {
    setData(base.data);
    setError(base.error);
  }, [base.data, base.error]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    let live = true;
    fnRef.current().then(
      (value) => {
        if (!live) return;
        setData(value);
        setError(null);
        setRefreshing(false);
      },
      (e: unknown) => {
        if (!live) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setRefreshing(false);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let cancel: (() => void) | null = null;
    const off = client.onChanged((changed) => {
      if (!pathsMatch(paths, changed)) return;
      cancel?.();
      cancel = refresh();
    });
    return () => {
      off();
      cancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paths compared by content
  }, [client, patternsKey, refresh]);

  useEffect(() => {
    if (!pollMs || pollMs <= 0) return;
    let cancel: (() => void) | null = null;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      cancel?.();
      cancel = refresh();
    }, pollMs);
    return () => {
      clearInterval(timer);
      cancel?.();
    };
  }, [pollMs, refresh]);

  return { data, error, loading: base.loading, reload: base.reload, refreshing };
}

// ── paging ──

export interface PagedListOptions {
  /** Rows per page; capped by the bridge at its row limit. Default: the bridge's cap. */
  pageSize?: number;
}

export interface PagedListResult<T> {
  /** Every row loaded so far, in order. */
  items: T[];
  loading: boolean;
  /** A `loadMore` in flight. */
  loadingMore: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Start again from the first page. */
  reload: () => void;
}

/**
 * Page through `context.list(glob)` a page at a time. Note that `pageSize`
 * cannot exceed the bridge's row cap — the server always pages at that size,
 * so a smaller `pageSize` is honoured by slicing client-side.
 */
export function usePagedList(glob: string | undefined, opts: PagedListOptions = {}): PagedListResult<ContextEntry> {
  const visvine = useVisvine();
  const [items, setItems] = useState<ContextEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  // Rows fetched but not yet handed out, when pageSize is under the server page.
  const bufferRef = useRef<ContextEntry[]>([]);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const pageSize = opts.pageSize && opts.pageSize > 0 ? Math.floor(opts.pageSize) : null;

  const fetchPage = useCallback(
    async (after: string | null, first: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const generation = generationRef.current;
      if (first) setLoading(true);
      else setLoadingMore(true);
      try {
        let batch: ContextEntry[] = [];
        let next = after;
        let more = true;
        // Serve from the buffer first; go to the server only when it is short.
        if (bufferRef.current.length > 0 && !first) {
          batch = bufferRef.current;
          bufferRef.current = [];
        }
        if (pageSize === null || batch.length < pageSize) {
          const page = await visvine.context.listPage(glob, after);
          if (generation !== generationRef.current) return;
          batch = batch.concat(page.items);
          next = page.nextCursor;
          more = page.nextCursor !== null;
        }
        if (pageSize !== null && batch.length > pageSize) {
          bufferRef.current = batch.slice(pageSize);
          batch = batch.slice(0, pageSize);
        }
        setItems((prev) => (first ? batch : prev.concat(batch)));
        setCursor(next);
        setHasMore(more || bufferRef.current.length > 0);
        setError(null);
      } catch (e: unknown) {
        if (generation !== generationRef.current) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (generation === generationRef.current) {
          inFlightRef.current = false;
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [visvine, glob, pageSize],
  );

  useEffect(() => {
    generationRef.current += 1;
    inFlightRef.current = false;
    bufferRef.current = [];
    setItems([]);
    setCursor(null);
    setHasMore(true);
    void fetchPage(null, true);
  }, [fetchPage, nonce]);

  const loadMore = useCallback(() => {
    if (!hasMore || inFlightRef.current) return;
    void fetchPage(cursor, false);
  }, [hasMore, cursor, fetchPage]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { items, loading, loadingMore, error, hasMore, loadMore, reload };
}
