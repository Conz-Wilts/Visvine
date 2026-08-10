'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAutosaveQueue, type AutosaveQueue, type SavePatch, type SaveStatus } from '@/lib/autosave';

export interface UseAutosaveResult {
  /** Merge a patch and schedule a save. `debounceMs: 0` (default) persists immediately. */
  queue: (patch: SavePatch, opts?: { debounceMs?: number }) => void;
  /** Send any pending (debounced) edits right now — wire to onBlur. */
  flush: () => void;
  /** Re-send the last failed patch (merged with anything queued since). */
  retry: () => void;
  status: SaveStatus;
}

/**
 * React binding for the pure autosave queue (`lib/autosave.ts`). One instance
 * per settings section; pending edits are flushed on unmount so switching
 * sections never loses a keystroke.
 *
 * The returned callbacks are stable and delegate through a ref, and a queue
 * disposed by an unmount is re-created on the next mount — this keeps the hook
 * working under React StrictMode's dev-time mount → unmount → mount cycle.
 */
export function useAutosave(save: (patch: SavePatch) => Promise<void>): UseAutosaveResult {
  const saveRef = useRef(save);
  saveRef.current = save;

  const [status, setStatus] = useState<SaveStatus>('idle');

  const queueRef = useRef<AutosaveQueue | null>(null);
  const ensureQueue = useCallback((): AutosaveQueue => {
    if (!queueRef.current || queueRef.current.isDisposed()) {
      queueRef.current = createAutosaveQueue((patch) => saveRef.current(patch), {
        onStatus: setStatus,
      });
    }
    return queueRef.current;
  }, []);

  useEffect(() => {
    ensureQueue();
    return () => queueRef.current?.dispose();
  }, [ensureQueue]);

  const queue = useCallback(
    (patch: SavePatch, opts?: { debounceMs?: number }) => ensureQueue().queue(patch, opts),
    [ensureQueue]
  );
  const flush = useCallback(() => ensureQueue().flush(), [ensureQueue]);
  const retry = useCallback(() => ensureQueue().retry(), [ensureQueue]);

  return { queue, flush, retry, status };
}
