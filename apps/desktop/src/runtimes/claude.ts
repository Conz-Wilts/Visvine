import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalResult, parseClaudeAuthStatus, parseClaudeLine } from "./events";
import { ask, stream } from "./process";
import { openInTerminal } from "./terminal";
import type { RunEvent, RunInput, RuntimeAdapter, RuntimeStatus } from "./types";

const BIN = "claude";

/**
 * Claude Code, unmodified, signed in by the member. What Anthropic permits is
 * exactly this: the binary does its own login and holds its own token, and we
 * run it as a child. So the shell never reads `~/.claude`, never passes
 * `--bare` (which drops the plan sign-in), and strips ANTHROPIC_API_KEY from
 * the child's env — an API key there outranks the plan and would silently
 * bill the wrong thing.
 *
 * The run is `-p` with stream-json in and out: one prompt, the events as they
 * happen, a `result` line at the end with the usage. Tools are the read-only
 * ones plus whatever the Visvine MCP server offers when the web app hands one
 * in; nothing on the member's disk is edited by a run.
 */
export const claudeRuntime: RuntimeAdapter = {
  id: "claude",

  async status(): Promise<RuntimeStatus> {
    const version = await ask(BIN, ["--version"], { timeoutMs: 10_000 });
    if (version.missing) return { id: "claude", installed: false, version: null, loggedIn: false, authMethod: null, detail: "Claude Code is not installed. Install it from claude.com/claude-code, then sign in." };
    const auth = await ask(BIN, ["auth", "status"], { timeoutMs: 15_000, env: { ANTHROPIC_API_KEY: "" } });
    const parsed = parseClaudeAuthStatus(auth.stdout);
    return {
      id: "claude",
      installed: true,
      version: version.stdout.trim().split(/\s+/)[0] || null,
      loggedIn: parsed.loggedIn,
      authMethod: parsed.authMethod,
      detail: parsed.loggedIn ? null : "Not signed in. Sign in opens Claude Code’s own login in a terminal.",
    };
  },

  async login() {
    return openInTerminal("claude auth login");
  },

  async run(input: RunInput, emit: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
    const cwd = input.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), "visvine-run-"));
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "default"];
    if (input.maxTurns) args.push("--max-turns", String(input.maxTurns));
    // Read-only reach on the member's machine, plus the web app's MCP tool.
    const allowed = ["WebFetch", "WebSearch"];
    if (input.mcp) {
      const config = path.join(cwd, "visvine-mcp.json");
      fs.writeFileSync(config, JSON.stringify({ mcpServers: { [input.mcp.name]: { type: "http", url: input.mcp.url } } }));
      args.push("--mcp-config", config, "--strict-mcp-config");
      allowed.push(`mcp__${input.mcp.name}__*`);
    }
    args.push("--allowedTools", ...allowed);

    const events: RunEvent[] = [];
    const push = (e: RunEvent) => {
      events.push(e);
      emit(e);
    };
    const exit = await stream(BIN, args, { cwd, env: { ANTHROPIC_API_KEY: "" }, stdin: input.prompt, signal }, (line) => {
      for (const e of parseClaudeLine(line)) if (e.type !== "result") push(e);
      for (const e of parseClaudeLine(line)) if (e.type === "result") events.push(e);
    });
    const result = finalResult(events);
    if (result) emit(result);
    else {
      const why = exit.missing
        ? "Claude Code is not installed."
        : signal.aborted
          ? "Stopped."
          : /not logged in|authentication|401|invalid.*key/i.test(exit.stderr)
            ? "Claude Code is not signed in. Sign in from Models in the account menu."
            : exit.stderr.trim().split("\n").slice(-3).join(" ") || `Claude Code exited with code ${exit.code ?? "?"}.`;
      emit({ at: Date.now(), type: "result", ok: false, text: null, error: why, turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 });
    }
  },
};
