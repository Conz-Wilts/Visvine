'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SavePatch, SaveStatus } from '@/lib/autosave';
import { useAutosave, type UseAutosaveResult } from '@/features/shared/hooks/useAutosave';

/**
 * Single save indicator for the whole Space Console. Every section —
 * autosaving forms and row actions alike — reports into this context so the
 * header shows one truthful "Saving… / Saved / Couldn't save" pill.
 */

export interface ConsoleSaveState {
  status: SaveStatus;
  /** Re-send the last failed save, when the reporter provided one. */
  retry: (() => void) | null;
}

interface ConsoleSaveContextValue extends ConsoleSaveState {
  report: (status: SaveStatus, retry?: (() => void) | null) => void;
}

const ConsoleSaveContext = createContext<ConsoleSaveContextValue>({
  status: 'idle',
  retry: null,
  report: () => {},
});

export function ConsoleSaveProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsoleSaveState>({ status: 'idle', retry: null });

  const report = useCallback((status: SaveStatus, retry?: (() => void) | null) => {
    setState({ status, retry: retry ?? null });
  }, []);

  const value = useMemo(() => ({ ...state, report }), [state, report]);
  return <ConsoleSaveContext.Provider value={value}>{children}</ConsoleSaveContext.Provider>;
}

export function useConsoleSave() {
  return useContext(ConsoleSaveContext);
}

/**
 * `useAutosave` wired into the console's shared indicator. This is what the
 * settings sections use: same API as `useAutosave`, but status changes also
 * surface in the console header.
 */
export function useConsoleAutosave(save: (patch: SavePatch) => Promise<void>): UseAutosaveResult {
  const autosave = useAutosave(save);
  const { report } = useConsoleSave();
  const { status, retry } = autosave;

  useEffect(() => {
    report(status, status === 'error' ? retry : null);
  }, [status, retry, report]);

  return autosave;
}

/**
 * For sections whose saves are discrete actions (member role changes, type
 * edits, …) rather than a patch queue: run the action while reporting
 * saving/saved/error into the shared indicator. Errors re-throw so callers
 * can also surface an inline message.
 */
export function useConsoleAction() {
  const { report } = useConsoleSave();

  return useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      report('saving');
      try {
        const result = await action();
        report('saved');
        return result;
      } catch (err) {
        report('error');
        throw err;
      }
    },
    [report]
  );
}
