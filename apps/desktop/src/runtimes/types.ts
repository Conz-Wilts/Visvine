/**
 * A local runtime is a vendor's own agent binary on this machine, signed in
 * to the member's own plan — Claude Code for a Claude plan, Codex for a
 * ChatGPT plan. The desktop shell spawns it and streams what it says back to
 * the web app; the shell never reads, stores or forwards the credential the
 * binary holds. That boundary is the whole reason this exists in the desktop
 * app and nowhere else (see docs on the web side: lib/agents/local.ts).
 */

export type RuntimeId = "claude" | "codex";

export interface RuntimeStatus {
  id: RuntimeId;
  /** The binary was found and answered. */
  installed: boolean;
  version: string | null;
  /** The binary reports a signed-in account. */
  loggedIn: boolean;
  /** How it is signed in, as the binary names it (e.g. "claude.ai", "chatgpt"). */
  authMethod: string | null;
  /** What went wrong finding or asking it, for the row to show. */
  detail: string | null;
}

export interface RunInput {
  runtime: RuntimeId;
  /** The whole prompt: the local preamble and the brief, assembled by the web app. */
  prompt: string;
  /** Working directory for the child; a scratch dir the shell owns by default. */
  cwd?: string;
  /** A Visvine MCP endpoint to hand the binary, so the run has the visvine tool. */
  mcp?: { name: string; url: string } | null;
  /** Cap on turns, where the binary supports one. */
  maxTurns?: number;
}

/** The same shape the web app records on a run (lib/agents/runs.ts#AgentRunEvent), plus the terminal `result`. */
export type RunEvent =
  | { at: number; type: "assistant"; text: string }
  | { at: number; type: "tool"; tool: string; detail: string }
  | { at: number; type: "tool_result"; tool: string; text: string }
  | { at: number; type: "system"; text: string }
  | {
      at: number;
      type: "result";
      ok: boolean;
      text: string | null;
      error: string | null;
      turns: number;
      promptTokens: number;
      completionTokens: number;
      /** Cache-read tokens, where the binary reports them. */
      cachedTokens: number;
    };

export interface RuntimeAdapter {
  id: RuntimeId;
  status(): Promise<RuntimeStatus>;
  /** Open the binary's own sign-in in a terminal window. The shell never proxies it. */
  login(): Promise<{ ok: boolean; detail: string | null }>;
  /** Spawn one run. Resolves once the child exits; `emit` sees every event first. */
  run(input: RunInput, emit: (event: RunEvent) => void, signal: AbortSignal): Promise<void>;
}
