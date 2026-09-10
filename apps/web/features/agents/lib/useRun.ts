'use client';

import { useEffect, useRef, useState } from 'react';
import { fetchJson } from '@/lib/fetchJson';
import { usePageVisible } from '@/features/shared/hooks/usePageVisible';
import type { AgentRunEvent } from '@/lib/agents/runs';
import type { SerializedRun } from '@/lib/agents/service';
import type { MachineEvent } from '@/lib/agents/shared/trace';

export interface RunDetail extends SerializedRun {
  events: AgentRunEvent[];
  transcriptHidden: boolean;
  /** The machine's record of this run — admins only, null otherwise. */
  machine: {
    events: MachineEvent[];
    refusals: { id: string; method: string; host: string; path: string; verdict: string; reason: string | null; at: string }[];
  } | null;
}

/**
 * One run, followed. Polls every two seconds while it is `running` — the
 * executor flushes the trace that often (lib/agents/limits.ts#FLUSH_EVERY_MS),
 * and polling is correct across many instances where a stream would not be —
 * then settles on the finished record. `onFinished` fires once, on the poll
 * that first sees the run end, so the page around it can catch up.
 */
export function useRun(
  spaceId: string | null,
  agentName: string | null,
  runId: string | null,
  onFinished?: (run: RunDetail) => void,
): { run: RunDetail | null; error: string | null } {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A hidden tab stops following; the flip back re-runs the effect, which is
  // the catch-up read.
  const visible = usePageVisible();
  // Whether the last poll saw the run still going — kept across a hidden
  // stretch so a run that ended while the tab was away still fires onFinished.
  const wasRunning = useRef<boolean | null>(null);

  useEffect(() => {
    setRun(null);
    setError(null);
    wasRunning.current = null;
  }, [spaceId, agentName, runId]);

  useEffect(() => {
    if (!spaceId || !agentName || !runId || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      try {
        const data = await fetchJson<{ run: RunDetail }>(
          `/api/communities/${spaceId}/agents/${encodeURIComponent(agentName)}/runs/${runId}`,
        );
        if (cancelled) return;
        setRun(data.run);
        setError(null);
        const running = data.run.status === 'running';
        if (running) timer = setTimeout(load, 2000);
        else if (wasRunning.current) onFinished?.(data.run);
        wasRunning.current = running;
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Could not follow the run');
        timer = setTimeout(load, 4000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // onFinished is a notification, not an input: a new callback identity must
    // not restart the poll mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, agentName, runId, visible]);

  return { run, error };
}
