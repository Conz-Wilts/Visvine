'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentRunEvent } from '@/lib/agents/runs';
import { desktopRuntimes, type DesktopRunEvent } from '@/features/desktop/lib/desktop';
import { fetchJson } from '@/lib/fetchJson';
import { LOCAL_RUNTIMES, type LocalRuntimeId } from '@/lib/agents/local';
import RunSteps from './RunSteps';
import StatusDot from './StatusDot';

/**
 * A run on the member's own plan, watched as it happens. The desktop shell
 * spawns the vendor's binary and streams its events here; when the binary
 * finishes, the whole run is posted to the server as an ordinary run row and
 * the page moves to that row. Until then this pane is the only record.
 */
interface Prepared {
  runtime: LocalRuntimeId;
  prompt: string;
  maxTurns: number;
  mcp: { name: string; path: string };
}

export default function LocalRunPane({
  spaceId,
  agentName,
  onRecorded,
  onFailed,
}: {
  spaceId: string;
  agentName: string;
  /** The server has the run now — its id, to select. */
  onRecorded: (runId: string) => void;
  onFailed: (message: string) => void;
}) {
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [phase, setPhase] = useState<'preparing' | 'running' | 'recording'>('preparing');
  const [runtime, setRuntime] = useState<LocalRuntimeId | null>(null);
  const [startedAt] = useState(() => Date.now());
  const runIdRef = useRef<string | null>(null);
  const eventsRef = useRef<AgentRunEvent[]>([]);

  useEffect(() => {
    const bridge = desktopRuntimes();
    if (!bridge) {
      onFailed('This agent runs on your own plan from the desktop app.');
      return;
    }
    let cancelled = false;
    let unsubscribe = () => {};

    const record = async (rt: LocalRuntimeId, result: Extract<DesktopRunEvent, { type: 'result' }>, wasCancelled: boolean) => {
      setPhase('recording');
      try {
        const res = await fetchJson<{ runId: string }>(`/api/spaces/${spaceId}/agents/${encodeURIComponent(agentName)}/local-runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            runtime: rt,
            ok: result.ok && !wasCancelled,
            events: eventsRef.current,
            turns: result.turns,
            promptTokens: result.promptTokens,
            completionTokens: result.completionTokens,
            summary: result.text,
            errorMessage: wasCancelled ? 'Stopped from the desktop app.' : result.error,
            cancelled: wasCancelled,
          }),
        });
        if (!cancelled) onRecorded(res.runId);
      } catch (e) {
        if (!cancelled) onFailed(e instanceof Error ? e.message : 'The run finished but could not be recorded.');
      }
    };

    (async () => {
      try {
        const prepared = await fetchJson<Prepared>(`/api/spaces/${spaceId}/agents/${encodeURIComponent(agentName)}/local-runs`);
        if (cancelled) return;
        setRuntime(prepared.runtime);
        unsubscribe = bridge.onEvent(({ runId, event }) => {
          if (runId !== runIdRef.current) return;
          if (event.type === 'result') {
            unsubscribe();
            void record(prepared.runtime, event, event.error === 'Stopped.');
            return;
          }
          eventsRef.current = [...eventsRef.current, event];
          setEvents(eventsRef.current);
        });
        const started = await bridge.run({
          runtime: prepared.runtime,
          prompt: prepared.prompt,
          maxTurns: prepared.maxTurns,
          mcp: { name: prepared.mcp.name, url: new URL(prepared.mcp.path, window.location.origin).toString() },
        });
        if ('error' in started) {
          onFailed(started.error);
          return;
        }
        runIdRef.current = started.runId;
        setPhase('running');
      } catch (e) {
        if (!cancelled) onFailed(e instanceof Error ? e.message : 'Could not start the run');
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
      if (runIdRef.current) void bridge.cancel(runIdRef.current);
    };
    // One run per mount: the pane is keyed by the press that made it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = LOCAL_RUNTIMES.find((r) => r.id === runtime)?.label.replace(/^Your/, 'your') ?? 'your plan';
  const line = phase === 'preparing' ? 'Preparing the run…' : phase === 'recording' ? 'Recording the run…' : `Running on ${label} from this machine`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[13px] text-text-secondary">
        <StatusDot tone="live" />
        <span>{line}</span>
        {phase === 'running' && runIdRef.current && (
          <button
            type="button"
            className="ml-auto rounded-md px-2 py-0.5 text-xs text-text-muted hover:bg-surface-3 hover:text-text-primary"
            onClick={() => runIdRef.current && void desktopRuntimes()?.cancel(runIdRef.current)}
          >
            Stop
          </button>
        )}
      </div>
      <RunSteps
        events={events}
        machine={[]}
        live
        startedAt={startedAt}
        trigger={{ kind: 'manual', label: 'Run, from the desktop app', events: null }}
        end={null}
        emptyText={phase === 'running' ? 'Starting…' : 'Preparing…'}
      />
    </div>
  );
}
