import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseClaudeLine, parseCodexLine, finalResult, parseClaudeAuthStatus, parseCodexLoginStatus, splitLines } = require("../dist/runtimes/events.js");
const { mergePaths } = require("../dist/runtimes/path.js");

test("claude: init, assistant text, tool use, tool result, and the terminal result", () => {
  const at = 1;
  assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"hook_started","hook_name":"x"}', at), []);
  assert.deepEqual(parseClaudeLine('{"type":"system","subtype":"init","model":"claude-sonnet-5"}', at), [
    { at, type: "system", text: "Running on your Claude plan (claude-sonnet-5)." },
  ]);
  assert.deepEqual(
    parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"text","text":"ok"},{"type":"tool_use","name":"WebFetch","input":{"url":"https://x"}}]}}', at),
    [
      { at, type: "assistant", text: "ok" },
      { at, type: "tool", tool: "WebFetch", detail: '{"url":"https://x"}' },
    ],
  );
  assert.deepEqual(parseClaudeLine('{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":[{"type":"text","text":"page"}]}]}}', at), [
    { at, type: "tool_result", tool: "t1", text: "page" },
  ]);
  assert.deepEqual(parseClaudeLine('{"type":"rate_limit_event","rate_limit_info":{}}', at), []);
  const [result] = parseClaudeLine(
    '{"type":"result","subtype":"success","is_error":false,"result":"done","num_turns":2,"total_cost_usd":0.2,"usage":{"input_tokens":2,"cache_creation_input_tokens":100,"cache_read_input_tokens":50,"output_tokens":4}}',
    at,
  );
  assert.deepEqual(result, { at, type: "result", ok: true, text: "done", error: null, turns: 2, promptTokens: 152, completionTokens: 4, cachedTokens: 50 });
  const [failed] = parseClaudeLine('{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":1,"usage":{}}', at);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "error_max_turns");
  assert.deepEqual(parseClaudeLine("not json", at), []);
});

test("codex: thread, messages, commands, usage, and failure", () => {
  const at = 1;
  assert.deepEqual(parseCodexLine('{"type":"thread.started","thread_id":"t"}', at), [{ at, type: "system", text: "Running on your ChatGPT plan." }]);
  assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}', at), [{ at, type: "assistant", text: "hello" }]);
  assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"command_execution","command":"ls","aggregated_output":"a\\nb","exit_code":0}}', at), [
    { at, type: "tool", tool: "command", detail: "ls" },
    { at, type: "tool_result", tool: "command", text: "a\nb" },
  ]);
  assert.deepEqual(parseCodexLine('{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}', at), []);
  assert.deepEqual(parseCodexLine('{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":4,"output_tokens":3}}', at), [
    { at, type: "result", ok: true, text: null, error: null, turns: 1, promptTokens: 10, completionTokens: 3, cachedTokens: 4 },
  ]);
  const [failed] = parseCodexLine('{"type":"turn.failed","error":{"message":"boom"}}', at);
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "boom");
});

test("finalResult fills codex's answer from the last message and sums usage", () => {
  const events = [
    { at: 1, type: "assistant", text: "first" },
    { at: 2, type: "result", ok: true, text: null, error: null, turns: 1, promptTokens: 10, completionTokens: 3, cachedTokens: 0 },
    { at: 3, type: "assistant", text: "final" },
    { at: 4, type: "result", ok: true, text: null, error: null, turns: 1, promptTokens: 5, completionTokens: 2, cachedTokens: 1 },
  ];
  const r = finalResult(events);
  assert.equal(r.text, "final");
  assert.equal(r.turns, 2);
  assert.equal(r.promptTokens, 15);
  assert.equal(r.completionTokens, 5);
  assert.equal(finalResult([{ at: 1, type: "assistant", text: "x" }]), null);
});

test("auth status parsing, both binaries", () => {
  assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}'), { loggedIn: true, authMethod: "claude.ai" });
  assert.deepEqual(parseClaudeAuthStatus('{"loggedIn":false}'), { loggedIn: false, authMethod: null });
  assert.equal(parseClaudeAuthStatus("Not logged in").loggedIn, false);
  assert.deepEqual(parseCodexLoginStatus("Logged in using ChatGPT", 0), { loggedIn: true, authMethod: "chatgpt" });
  assert.deepEqual(parseCodexLoginStatus("Not logged in", 1), { loggedIn: false, authMethod: null });
});

test("splitLines keeps a partial tail for the next chunk", () => {
  const a = splitLines("", '{"a":1}\n{"b":');
  assert.deepEqual(a.lines, ['{"a":1}']);
  assert.equal(a.rest, '{"b":');
  const b = splitLines(a.rest, '2}\n');
  assert.deepEqual(b.lines, ['{"b":2}']);
  assert.equal(b.rest, "");
});

test("mergePaths prefers the login shell's PATH, dedupes, and appends the user bin dirs", () => {
  const merged = mergePaths("/usr/bin:/bin", "/Users/x/.local/bin:/usr/bin", ["/opt/homebrew/bin", "/bin"]);
  assert.equal(merged, ["/Users/x/.local/bin", "/usr/bin", "/bin", "/opt/homebrew/bin"].join(":"));
  assert.equal(mergePaths(undefined, undefined, ["/a"]), "/a");
});
