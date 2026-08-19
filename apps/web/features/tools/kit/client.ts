/**
 * The in-frame half of the bridge: the only thing inside a Tool's iframe that
 * is allowed to talk to Visvine.
 *
 * This file is compiled by esbuild into the browser bundle authors import as
 * `@visvine/tool-kit`, so it may not pull in app runtime code — every import
 * here is `type`-only, and the two constants it would otherwise borrow from
 * `lib/tools/protocol` are restated below and pinned to their originals by
 * tests/tools-kit-client.test.ts.
 *
 * Two rules make this safe to hand to code we did not write:
 *   • it posts only to `win.parent`, never to an arbitrary window, and always
 *     with an explicit `parentOrigin` — never `'*'`, so a relocated parent
 *     silently drops the message rather than leaking it;
 *   • it ignores every inbound message whose `event.origin` is not exactly
 *     `parentOrigin`. The frame is sandboxed without `allow-same-origin`, so
 *     its own origin is opaque and this is the whole trust check.
 *
 * It carries no authority of its own: a call is a request the host relays to
 * the server, which decides under the viewer's grants and the Tool's declared
 * perimeter. Nothing here can widen that.
 */
import type {
  BridgeError,
  BridgeErrorCode,
  BridgeMethod,
  BridgeParams,
  BridgeResult,
  FrameMessage,
  ToolInitMessage,
  ToolSubject,
} from '@/lib/tools/protocol';

/** Mirrors `PROTOCOL_VERSION` in lib/tools/protocol.ts (pinned by a test). */
export const PROTOCOL_VERSION = 1;

/** How long an ordinary call waits before giving up on the host. */
export const CALL_TIMEOUT_MS = 15_000;

/**
 * `data.call` runs a handler in the QuickJS isolate, which the server itself
 * caps at `BRIDGE_LIMITS.dataCallTimeoutMs`. We wait that long plus a grace
 * window so the server's own `timeout` error — which names the handler — wins
 * the race against ours, which cannot.
 */
export const DATA_CALL_TIMEOUT_MS = 25_000;

/** A refused or failed bridge call, carrying the server's code for branching. */
export class BridgeCallError extends Error {
  readonly code: BridgeErrorCode;

  constructor(error: BridgeError) {
    super(error.message);
    this.name = 'BridgeCallError';
    this.code = error.code;
  }
}

type Unsubscribe = () => void;

export interface BridgeClient {
  /** Ask the host for something. Rejects with a `BridgeCallError`. */
  call<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>>;
  /** Fires once the handshake lands; late subscribers get the init they missed. */
  onInit(fn: (init: ToolInitMessage) => void): Unsubscribe;
  onTheme(fn: (theme: Record<string, string>) => void): Unsubscribe;
  onSubject(fn: (subject: ToolSubject | null) => void): Unsubscribe;
  /** Note paths inside the perimeter changed. Best-effort; see useLiveQuery. */
  onChanged(fn: (paths: string[]) => void): Unsubscribe;
  /** Tell the host the frame is listening. The host replies with `visvine:init`. */
  ready(): void;
  /** Report an uncaught error so the host can render its error card. */
  reportError(message: string, stack?: string): void;
  /** Ask the host to resize the iframe to fit `height` CSS pixels. */
  resize(height: number): void;
  /** Ask the app to navigate. The host refuses anything that is not in-app. */
  navigate(path: string): void;
  /** Drop the listener and fail everything still in flight. */
  close(): void;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: BridgeCallError) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A local, structural read of the five host messages this client acts on.
 * Deliberately not `isHostMessage` from lib/tools/protocol — importing it as a
 * value would drag app code into the sandbox bundle. The origin check above is
 * the security boundary; this is only here so a malformed message is dropped
 * instead of crashing the Tool.
 */
function hostMessageType(data: unknown): string | null {
  return isRecord(data) && typeof data.type === 'string' ? data.type : null;
}

export function createBridgeClient(win: Window, parentOrigin: string): BridgeClient {
  const pending = new Map<string, Pending>();
  const initListeners = new Set<(init: ToolInitMessage) => void>();
  const themeListeners = new Set<(theme: Record<string, string>) => void>();
  const subjectListeners = new Set<(subject: ToolSubject | null) => void>();
  const changedListeners = new Set<(paths: string[]) => void>();

  let lastInit: ToolInitMessage | null = null;
  let seq = 0;
  let closed = false;

  function post(message: FrameMessage): void {
    if (closed) return;
    win.parent.postMessage(message, parentOrigin);
  }

  function settle(id: string, run: (p: Pending) => void): void {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    run(p);
  }

  function onMessage(event: MessageEvent): void {
    if (event.origin !== parentOrigin) return;
    const data: unknown = event.data;
    switch (hostMessageType(data)) {
      case 'visvine:init': {
        const init = data as ToolInitMessage;
        lastInit = init;
        initListeners.forEach((fn) => fn(init));
        break;
      }
      case 'visvine:result': {
        const msg = data as { id: string; ok: boolean; value?: unknown; error?: BridgeError };
        if (typeof msg.id !== 'string') break;
        settle(msg.id, (p) => {
          if (msg.ok) p.resolve(msg.value);
          else p.reject(new BridgeCallError(msg.error ?? { code: 'internal', message: 'The call failed.' }));
        });
        break;
      }
      case 'visvine:theme': {
        const theme = (data as { theme?: Record<string, string> }).theme;
        if (theme) themeListeners.forEach((fn) => fn(theme));
        break;
      }
      case 'visvine:subject': {
        const subject = (data as { subject: ToolSubject | null }).subject ?? null;
        subjectListeners.forEach((fn) => fn(subject));
        break;
      }
      case 'visvine:changed': {
        const paths = (data as { paths?: unknown }).paths;
        if (Array.isArray(paths) && paths.every((p) => typeof p === 'string')) {
          changedListeners.forEach((fn) => fn(paths as string[]));
        }
        break;
      }
      default:
        break;
    }
  }

  win.addEventListener('message', onMessage);

  function subscribe<T>(set: Set<(value: T) => void>, fn: (value: T) => void): Unsubscribe {
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  return {
    call<M extends BridgeMethod>(method: M, params: BridgeParams<M>): Promise<BridgeResult<M>> {
      if (closed) {
        return Promise.reject(
          new BridgeCallError({ code: 'internal', message: 'This Tool is no longer connected to Visvine.' }),
        );
      }
      seq += 1;
      const id = `c${seq}`;
      const timeoutMs = method === 'data.call' ? DATA_CALL_TIMEOUT_MS : CALL_TIMEOUT_MS;
      return new Promise<BridgeResult<M>>((resolve, reject) => {
        const timer = setTimeout(() => {
          settle(id, (p) =>
            p.reject(new BridgeCallError({ code: 'timeout', message: `${method} did not answer within ${timeoutMs}ms.` })),
          );
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        try {
          post({ type: 'visvine:call', id, method, params });
        } catch (e) {
          settle(id, (p) =>
            p.reject(new BridgeCallError({ code: 'internal', message: e instanceof Error ? e.message : 'postMessage failed.' })),
          );
        }
      });
    },

    onInit(fn) {
      const off = subscribe(initListeners, fn);
      // A Tool that mounts after the handshake still needs it, and the host
      // sends init exactly once.
      if (lastInit) fn(lastInit);
      return off;
    },

    onTheme(fn) {
      return subscribe(themeListeners, fn);
    },

    onSubject(fn) {
      return subscribe(subjectListeners, fn);
    },

    onChanged(fn) {
      return subscribe(changedListeners, fn);
    },

    ready() {
      post({ type: 'visvine:ready', version: PROTOCOL_VERSION });
    },

    reportError(message, stack) {
      post(stack === undefined ? { type: 'visvine:error', message } : { type: 'visvine:error', message, stack });
    },

    resize(height) {
      if (!Number.isFinite(height) || height < 0) return;
      post({ type: 'visvine:resize', height: Math.ceil(height) });
    },

    navigate(path) {
      post({ type: 'visvine:navigate', path });
    },

    close() {
      if (closed) return;
      closed = true;
      win.removeEventListener('message', onMessage);
      for (const id of Array.from(pending.keys())) {
        settle(id, (p) =>
          p.reject(new BridgeCallError({ code: 'internal', message: 'This Tool is no longer connected to Visvine.' })),
        );
      }
      initListeners.clear();
      themeListeners.clear();
      subjectListeners.clear();
      changedListeners.clear();
    },
  };
}
