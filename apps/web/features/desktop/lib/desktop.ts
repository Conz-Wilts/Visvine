'use client';

import type { AgentRunEvent } from '@/lib/agents/runs';
import type { LocalRuntimeId } from '@/lib/agents/local';

/**
 * The desktop shell's bridge, as the web app sees it — `window.visvineDesktop`
 * from apps/desktop/src/preload.ts. Absent in a browser, present with
 * `runtimes` in a shell new enough to run a member's own plan
 * (apps/desktop/src/runtimes). Nothing on it returns a credential.
 */
export interface DesktopRuntimeStatus {
  id: LocalRuntimeId;
  installed: boolean;
  version: string | null;
  loggedIn: boolean;
  authMethod: string | null;
  detail: string | null;
}

/** The desktop's run event: the run's own events, then one `result`. */
export type DesktopRunEvent =
  | AgentRunEvent
  | { at: number; type: 'result'; ok: boolean; text: string | null; error: string | null; turns: number; promptTokens: number; completionTokens: number; cachedTokens: number };

interface DesktopRuntimes {
  list(): Promise<DesktopRuntimeStatus[]>;
  login(id: LocalRuntimeId): Promise<{ ok: boolean; detail: string | null }>;
  run(input: { runtime: LocalRuntimeId; prompt: string; mcp?: { name: string; url: string } | null; maxTurns?: number }): Promise<{ runId: string } | { error: string }>;
  cancel(runId: string): Promise<boolean>;
  onEvent(listener: (payload: { runId: string; event: DesktopRunEvent }) => void): () => void;
}

interface DesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  /** Absent in a shell older than the page's say over the traffic lights. */
  setWindowControls?(position: { x: number; y: number }): void;
  runtimes?: DesktopRuntimes;
}

declare global {
  interface Window {
    visvineDesktop?: DesktopBridge;
  }
}

/** The runtimes bridge, or null in a browser or an older shell. */
export function desktopRuntimes(): DesktopRuntimes | null {
  if (typeof window === 'undefined') return null;
  return window.visvineDesktop?.runtimes ?? null;
}

