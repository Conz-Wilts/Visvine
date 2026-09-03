import { randomUUID } from "node:crypto";
import { claudeRuntime } from "./claude";
import { codexRuntime } from "./codex";
import type { RunEvent, RunInput, RuntimeAdapter, RuntimeId, RuntimeStatus } from "./types";

export type { RunEvent, RunInput, RuntimeId, RuntimeStatus } from "./types";

const ADAPTERS: Record<RuntimeId, RuntimeAdapter> = { claude: claudeRuntime, codex: codexRuntime };

export function isRuntimeId(value: unknown): value is RuntimeId {
  return value === "claude" || value === "codex";
}

/** Every runtime's status, asked in parallel; a slow or missing binary answers as such, never throws. */
export function listRuntimes(): Promise<RuntimeStatus[]> {
  return Promise.all(Object.values(ADAPTERS).map((a) => a.status()));
}

export function loginRuntime(id: RuntimeId) {
  return ADAPTERS[id].login();
}

const running = new Map<string, AbortController>();
const MAX_CONCURRENT = 2;

/**
 * Start one run and stream its events to `emit`. Returns the run's id at
 * once; the promise settles when the child exits. Two at a time — a plan is
 * one person's, and a third concurrent run is a bug in the caller.
 */
export function startRun(input: RunInput, emit: (runId: string, event: RunEvent) => void): { runId: string; done: Promise<void> } | { error: string } {
  if (!isRuntimeId(input.runtime)) return { error: "Unknown runtime." };
  if (running.size >= MAX_CONCURRENT) return { error: "Two runs are already going on this machine." };
  const runId = randomUUID();
  const controller = new AbortController();
  running.set(runId, controller);
  const done = ADAPTERS[input.runtime]
    .run(input, (e) => emit(runId, e), controller.signal)
    .catch((err) => {
      emit(runId, { at: Date.now(), type: "result", ok: false, text: null, error: String(err instanceof Error ? err.message : err), turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 });
    })
    .finally(() => running.delete(runId));
  return { runId, done };
}

export function cancelRun(runId: string): boolean {
  const controller = running.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}
