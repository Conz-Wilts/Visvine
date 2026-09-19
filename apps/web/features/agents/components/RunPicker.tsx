'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@/features/shared/icons';
import { SEARCH_MENU_PANEL, SEARCH_MENU_ROW, searchMenuRowState } from '@/components/ui/SearchMenu';
import type { SerializedRun } from '@/lib/agents/service';
import { fmtAgo, fmtDuration, terminalLabel } from '../lib/rowState';
import StatusDot from './StatusDot';

/**
 * Which run the page is showing, as a word you can change: "30 h ago ▾" opens
 * the agent's recent runs — how each went, when, for whom, how long.
 */
export default function RunPicker({
  runs,
  shownRunId,
  whoOf,
  onSelect,
}: {
  runs: SerializedRun[];
  shownRunId: string | null;
  /** The person a run acted for, when that is worth saying. */
  whoOf: (run: SerializedRun) => string | null;
  onSelect: (runId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = runs.find((r) => r.id === shownRunId) ?? null;
  if (!shown) return null;
  if (runs.length < 2) return <span className="shrink-0 text-[12px] text-text-muted">{fmtAgo(shown.startedAt)}</span>;

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
        onClick={() => setOpen((o) => !o)}
      >
        {fmtAgo(shown.startedAt)}
        <ChevronDownIcon className="h-3 w-3" />
      </button>
      {open && (
        <ul role="listbox" className={`${SEARCH_MENU_PANEL} absolute right-0 top-full mt-1 max-h-80 w-72 overflow-y-auto py-1`}>
          {runs.map((r) => {
            const who = whoOf(r);
            return (
              <li key={r.id} role="option" aria-selected={r.id === shownRunId}>
                <button
                  type="button"
                  className={`${SEARCH_MENU_ROW} ${searchMenuRowState(r.id === shownRunId)} text-[13px]`}
                  onClick={() => {
                    setOpen(false);
                    onSelect(r.id);
                  }}
                >
                  <StatusDot tone={r.status === 'running' ? 'live' : r.status === 'failed' ? 'bad' : 'ok'} />
                  <span className="min-w-0 flex-1 truncate text-text-primary">
                    {fmtAgo(r.startedAt)}
                    {who ? <span className="text-text-muted"> · {who}</span> : null}
                  </span>
                  <span className={`shrink-0 text-[11.5px] ${r.status === 'failed' ? 'text-red-600' : 'tabular-nums text-text-muted'}`}>
                    {r.status === 'running' ? 'now' : r.status === 'failed' ? terminalLabel(r.terminalReason) || 'failed' : fmtDuration(r.startedAt, r.endedAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
