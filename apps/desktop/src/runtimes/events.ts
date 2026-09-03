import type { RunEvent } from "./types";

/**
 * The pure half: one line of a binary's JSONL → the run events it means.
 * Kept free of child_process so the parsing is unit-tested against the real
 * shapes the binaries emit (tests/runtimes.test.mjs).
 */

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Claude Code, `--output-format stream-json --verbose`:
 *   {type:"system", subtype:"init"|"hook_*"...}
 *   {type:"assistant", message:{content:[{type:"text",text}|{type:"tool_use",name,input}]}}
 *   {type:"user", message:{content:[{type:"tool_result",tool_use_id,content}]}}
 *   {type:"rate_limit_event", ...}
 *   {type:"result", subtype:"success"|"error_*", is_error, result, num_turns, usage:{input_tokens,output_tokens,cache_read_input_tokens}}
 * Hook chatter and rate-limit telemetry are dropped; an init line becomes one
 * system event naming the model.
 */
export function parseClaudeLine(line: string, at = Date.now()): RunEvent[] {
  let json: Json | null;
  try {
    json = asObject(JSON.parse(line));
  } catch {
    return [];
  }
  if (!json) return [];
  const type = str(json.type);
  if (type === "system") {
    if (str(json.subtype) !== "init") return [];
    const model = str(json.model);
    return [{ at, type: "system", text: `Running on your Claude plan${model ? ` (${model})` : ""}.` }];
  }
  if (type === "assistant" || type === "user") {
    const message = asObject(json.message);
    const content = Array.isArray(message?.content) ? (message!.content as unknown[]) : [];
    const out: RunEvent[] = [];
    for (const raw of content) {
      const block = asObject(raw);
      if (!block) continue;
      const kind = str(block.type);
      if (kind === "text" && str(block.text).trim()) out.push({ at, type: "assistant", text: str(block.text) });
      else if (kind === "tool_use") out.push({ at, type: "tool", tool: str(block.name) || "tool", detail: JSON.stringify(block.input ?? {}) });
      else if (kind === "tool_result") {
        const body = block.content;
        const text = typeof body === "string" ? body : Array.isArray(body) ? body.map((b) => str(asObject(b)?.text)).filter(Boolean).join("\n") : JSON.stringify(body ?? "");
        out.push({ at, type: "tool_result", tool: str(block.tool_use_id) || "tool", text });
      }
    }
    return out;
  }
  if (type === "result") {
    const usage = asObject(json.usage) ?? {};
    const isError = json.is_error === true || str(json.subtype).startsWith("error");
    return [
      {
        at,
        type: "result",
        ok: !isError,
        text: str(json.result) || null,
        error: isError ? str(json.result) || str(json.subtype) || "The run failed." : null,
        turns: num(json.num_turns),
        promptTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens),
        completionTokens: num(usage.output_tokens),
        cachedTokens: num(usage.cache_read_input_tokens),
      },
    ];
  }
  return [];
}

/**
 * Codex, `codex exec --json`:
 *   {type:"thread.started", thread_id}
 *   {type:"turn.started"}
 *   {type:"item.started"|"item.completed", item:{type:"agent_message",text}|{type:"command_execution",command,aggregated_output,exit_code}|{type:"mcp_tool_call",server,tool,...}|{type:"reasoning",text}}
 *   {type:"turn.completed", usage:{input_tokens,cached_input_tokens,output_tokens}}
 *   {type:"turn.failed", error:{message}} | {type:"error", message}
 * The last agent_message is the answer; `turn.completed` carries the usage.
 * A turn is one prompt→answer here, so turns is 1 per completed turn.
 */
export function parseCodexLine(line: string, at = Date.now()): RunEvent[] {
  let json: Json | null;
  try {
    json = asObject(JSON.parse(line));
  } catch {
    return [];
  }
  if (!json) return [];
  const type = str(json.type);
  if (type === "thread.started") return [{ at, type: "system", text: "Running on your ChatGPT plan." }];
  if (type === "item.completed") {
    const item = asObject(json.item);
    if (!item) return [];
    const kind = str(item.type);
    if (kind === "agent_message" && str(item.text).trim()) return [{ at, type: "assistant", text: str(item.text) }];
    if (kind === "command_execution") {
      return [
        { at, type: "tool", tool: "command", detail: str(item.command) },
        { at, type: "tool_result", tool: "command", text: str(item.aggregated_output) || `exit ${num(item.exit_code)}` },
      ];
    }
    if (kind === "mcp_tool_call") {
      const tool = `${str(item.server)}.${str(item.tool)}`;
      return [
        { at, type: "tool", tool, detail: JSON.stringify(item.arguments ?? {}) },
        { at, type: "tool_result", tool, text: typeof item.result === "string" ? item.result : JSON.stringify(item.result ?? item.error ?? "") },
      ];
    }
    return [];
  }
  if (type === "turn.completed") {
    const usage = asObject(json.usage) ?? {};
    return [
      {
        at,
        type: "result",
        ok: true,
        text: null,
        error: null,
        turns: 1,
        promptTokens: num(usage.input_tokens),
        completionTokens: num(usage.output_tokens),
        cachedTokens: num(usage.cached_input_tokens),
      },
    ];
  }
  if (type === "turn.failed" || type === "error") {
    const error = str(asObject(json.error)?.message) || str(json.message) || "The run failed.";
    return [{ at, type: "result", ok: false, text: null, error, turns: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0 }];
  }
  return [];
}

/**
 * Codex's `turn.completed` carries no answer text, so the answer is the last
 * agent message before it. Fold a stream into its final result the way the
 * web app wants it: the terminal event, with the answer filled in.
 */
export function finalResult(events: RunEvent[]): Extract<RunEvent, { type: "result" }> | null {
  const results = events.filter((e): e is Extract<RunEvent, { type: "result" }> => e.type === "result");
  if (results.length === 0) return null;
  const last = results[results.length - 1];
  const lastText = [...events].reverse().find((e) => e.type === "assistant") as Extract<RunEvent, { type: "assistant" }> | undefined;
  return {
    ...last,
    text: last.text ?? lastText?.text ?? null,
    turns: results.reduce((n, r) => n + r.turns, 0),
    promptTokens: results.reduce((n, r) => n + r.promptTokens, 0),
    completionTokens: results.reduce((n, r) => n + r.completionTokens, 0),
    cachedTokens: results.reduce((n, r) => n + r.cachedTokens, 0),
  };
}

/** Claude Code's `auth status` JSON → whether it is signed in, and how. */
export function parseClaudeAuthStatus(stdout: string): { loggedIn: boolean; authMethod: string | null } {
  try {
    const json = asObject(JSON.parse(stdout));
    if (!json) return { loggedIn: false, authMethod: null };
    return { loggedIn: json.loggedIn === true, authMethod: str(json.authMethod) || null };
  } catch {
    return { loggedIn: /logged in/i.test(stdout) && !/not logged in/i.test(stdout), authMethod: null };
  }
}

/** Codex's `login status` prose → the same. Exit code 0 means signed in; the text says how. */
export function parseCodexLoginStatus(stdout: string, exitCode: number): { loggedIn: boolean; authMethod: string | null } {
  const text = stdout.toLowerCase();
  if (exitCode !== 0 || /not logged in/.test(text)) return { loggedIn: false, authMethod: null };
  if (/chatgpt/.test(text)) return { loggedIn: true, authMethod: "chatgpt" };
  if (/api key/.test(text)) return { loggedIn: true, authMethod: "api-key" };
  return { loggedIn: true, authMethod: null };
}

/** Split a chunked stdout stream into whole lines, keeping the tail for the next chunk. */
export function splitLines(buffer: string, chunk: string): { lines: string[]; rest: string } {
  const all = buffer + chunk;
  const parts = all.split(/\r?\n/);
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim().length > 0), rest };
}
