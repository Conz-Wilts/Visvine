/**
 * Pure autosave queue — the core of the console's "change it and it's saved" model.
 *
 * Semantics:
 * - queue(patch) merges patches key-by-key (last write wins) and schedules a save,
 *   optionally debounced (text inputs) or immediate (toggles, selects, colors).
 * - One request in flight at a time; edits made mid-flight are held and sent
 *   in a single follow-up request once the current one settles.
 * - A failed patch is never discarded: it is retained, retried once automatically
 *   after `retryDelayMs`, and merged into the next manual retry()/queue() send.
 *
 * No React here — timers are injectable so the logic is unit-testable under
 * Node's test runner (see tests/autosave.test.ts).
 */

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type SavePatch = Record<string, unknown>;

export interface AutosaveQueue {
  queue(patch: SavePatch, opts?: { debounceMs?: number }): void;
  flush(): void;
  retry(): void;
  getStatus(): SaveStatus;
  isDisposed(): boolean;
  /** Flush pending edits and stop reporting status (call on unmount). */
  dispose(): void;
}

interface AutosaveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface AutosaveOptions {
  onStatus?: (status: SaveStatus) => void;
  /** How long "saved" is shown before returning to idle. */
  savedDisplayMs?: number;
  /** Delay before the single automatic retry after a failure. */
  retryDelayMs?: number;
  /** Injectable timers for tests. */
  timers?: AutosaveTimers;
}

export function createAutosaveQueue(
  save: (patch: SavePatch) => Promise<void>,
  options: AutosaveOptions = {}
): AutosaveQueue {
  const { onStatus, savedDisplayMs = 2000, retryDelayMs = 2000 } = options;
  const timers: AutosaveTimers = options.timers ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };

  let pending: SavePatch = {};
  let failed: SavePatch | null = null;
  let inFlight = false;
  let autoRetried = false;
  let disposed = false;
  let status: SaveStatus = 'idle';

  let debounceTimer: unknown = null;
  let savedTimer: unknown = null;
  let retryTimer: unknown = null;

  function setStatus(next: SaveStatus) {
    status = next;
    if (!disposed) onStatus?.(next);
  }

  function clearTimer(id: unknown): null {
    if (id !== null) timers.clearTimeout(id);
    return null;
  }

  async function send(): Promise<void> {
    if (inFlight) return;
    retryTimer = clearTimer(retryTimer);
    const patch: SavePatch = { ...(failed ?? {}), ...pending };
    if (Object.keys(patch).length === 0) return;
    pending = {};
    failed = null;
    inFlight = true;
    savedTimer = clearTimer(savedTimer);
    setStatus('saving');
    try {
      await save(patch);
      inFlight = false;
      autoRetried = false;
      if (Object.keys(pending).length > 0) {
        // Edits arrived mid-flight — send them now in one follow-up request.
        void send();
      } else {
        setStatus('saved');
        savedTimer = timers.setTimeout(() => {
          savedTimer = null;
          if (status === 'saved') setStatus('idle');
        }, savedDisplayMs);
      }
    } catch {
      inFlight = false;
      failed = patch;
      setStatus('error');
      if (!autoRetried && !disposed) {
        autoRetried = true;
        retryTimer = timers.setTimeout(() => {
          retryTimer = null;
          void send();
        }, retryDelayMs);
      }
    }
  }

  return {
    queue(patch, opts = {}) {
      if (disposed) return;
      pending = { ...pending, ...patch };
      debounceTimer = clearTimer(debounceTimer);
      if (inFlight) return; // held; sent when the current request settles
      const debounceMs = opts.debounceMs ?? 0;
      if (debounceMs <= 0) {
        void send();
      } else {
        debounceTimer = timers.setTimeout(() => {
          debounceTimer = null;
          void send();
        }, debounceMs);
      }
    },
    flush() {
      if (disposed) return;
      debounceTimer = clearTimer(debounceTimer);
      void send();
    },
    retry() {
      if (disposed) return;
      autoRetried = false;
      void send();
    },
    getStatus() {
      return status;
    },
    isDisposed() {
      return disposed;
    },
    dispose() {
      if (disposed) return;
      debounceTimer = clearTimer(debounceTimer);
      // Fire pending edits so navigating away doesn't lose them,
      // but stop status callbacks and further retries.
      void send();
      disposed = true;
      savedTimer = clearTimer(savedTimer);
      retryTimer = clearTimer(retryTimer);
    },
  };
}
