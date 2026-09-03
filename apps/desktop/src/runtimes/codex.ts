import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finalResult, parseCodexLine, parseCodexLoginStatus } from "./events";
import { ask, stream } from "./process";
import { openInTerminal } from "./terminal";
import type { RunEvent, RunInput, RuntimeAdapter, RuntimeStatus } from "./types";

const BIN = "codex";

/**
 * Codex, signed in with ChatGPT. `codex login` runs the vendor's own OAuth
 * (browser on localhost:1455) and Codex holds and refreshes the token in
 * `~/.codex/auth.json`; the shell only ever asks `codex login status` and
 * spawns `codex exec`. OPENAI_API_KEY is stripped from the child's env for
 * the same reason as Anthropic's: a key there outranks the plan.
 *
 * `codex exec --json` is the non-interactive run: JSONL items as they land,
 * `turn.completed` with the usage. The sandbox is read-only, so a run reads
 * the member's machine and writes nothing to it; Visvine's tool arrives as an
 * MCP server in a per-run config file.
 */
export const codexRuntime: RuntimeAdapter = {
  id: "codex",

  async status(): Promise<RuntimeStatus> {
    const version = await ask(BIN, ["--version"], { timeoutMs: 10_000 });
    if (version.missing) return { id: "codex", installed: false, version: null, loggedIn: false, authMethod: null, detail: "Codex is not installed. Install it with `npm i -g @openai/codex`, then sign in." };
    const auth = await ask(BIN, ["login", "status"], { timeoutMs: 15_000, env: { OPENAI_API_KEY: "" } });
    const parsed = parseCodexLoginStatus(`${auth.stdout}\n${auth.stderr}`, auth.code);
    return {
      id: "codex",
      installed: true,
      version: version.stdout.trim().split(/\s+/).pop() || null,
      loggedIn: parsed.loggedIn,
      authMethod: parsed.authMethod,
      detail: parsed.loggedIn ? null : "Not signed in. Sign in opens Codex’s own ChatGPT login in a terminal.",
    };
  },

  async login() {
    return openInTerminal("codex login");
  },

  async run(input: RunInput, emit: (event: RunEvent) => void, signal: AbortSignal): Promise<void> {
    const cwd = input.cwd ?? fs.mkdtempSync(path.join(os.tmpdir(), "visvine-run-"));
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "--cd", cwd];
    if (input.mcp) {
      // Codex reads MCP servers from its config; a per-run override keeps the
      // member's own ~/.codex/config.toml untouched.
      args.push("-c", `mcp_servers.${input.mcp.name}.url=${JSON.stringify(input.mcp.url)}`);
    }
    // The prompt rides stdin (`-` means read it there), so nothing about the
    // brief lands in a process list.
    args.push("-");

    const events: RunEvent[] = [];
    const push = (e: RunEvent) => {
      events.push(e);
      emit(e);
    };
    const exit = await stream(BIN, args, { cwd, env: { OPENAI_API_KEY: "" }, stdin: input.prompt, signal }, (line) => {
      for (const e of parseCodexLine(line)) {
        if (e.type === "result") events.push(e);
        else push(e);
      }
    });
    const result = finalResult(events);
    if (result) emit(result);
    else {
      const why = exit.missing
        ? "Codex is not installed."
        : signal.aborted
          ? "Stopped."
          : /not logged in|login|401|unauthorized/i.test(exit.stderr)
            ? "Codex is not signed in. Sign in from Models in the account menu."
            : exit.stderr.trim().split("\n").slice(-3).join(" ") || `Codex exited with code ${exit.code ?? "?"}.`;
      emit({ at: Date.now(), type: "result", ok: false, text: null, error: why, turns: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0 });
    }
  },
};
