# Claude Code hooks

Project-scoped [Claude Code hooks](https://docs.claude.com/en/docs/claude-code/hooks)
for this repo. Wired up in `.claude/settings.json`; this is the canonical
location Claude Code looks for hook scripts, so they live here rather than in a
made-up folder.

## Visual-change verification

Enforces that any UI edit gets confirmed in a real browser via the **Playwright
MCP** (`playwright`, configured in the repo-root `.mcp.json`) before a turn ends.

| Script | Hook event | Matcher | Role |
|---|---|---|---|
| `flag-visual-edit.mjs` | `PostToolUse` | `Write\|Edit` | On a `.tsx/.jsx/.css/.scss` edit, records a pending marker + reminds the model to verify |
| `clear-visual-flag.mjs` | `PostToolUse` | `mcp__playwright__.*` | Any Playwright MCP tool clears the marker (= verified) |
| `require-visual-verify.mjs` | `Stop` | — | Blocks finishing while a marker is still pending |

Shared logic lives in `lib/visual-verify.mjs`.

## Screenshot routing

| Script | Hook event | Matcher | Role |
|---|---|---|---|
| `route-screenshot.mjs` | `PreToolUse` | `mcp__playwright__browser_take_screenshot` | Creates `screenshots/` if missing and rewrites the screenshot `filename` to live inside it |

This version of `@playwright/mcp` resolves a *custom* relative `filename` against
the process cwd (the repo root) and **ignores** the server's `--output-dir` —
which only governs auto-named artifacts (console logs, page snapshots → `.playwright-mcp/`).
So a `filename: "foo.png"` would otherwise drop `foo.png` into the project root.
The hook fixes this at the call site: it `mkdir -p`s `screenshots/` (the screenshot
call itself won't create it) and returns `hookSpecificOutput.updatedInput` with the
filename moved into `screenshots/`. Absolute paths and names already under
`screenshots/` pass through unchanged; a missing filename gets a timestamped default.
`screenshots/` is gitignored. As a fallback (in case `updatedInput` isn't honoured
for MCP tools), callers should pass filenames already prefixed with `screenshots/`
(documented in the repo `CLAUDE.md`). Pending markers are written to
`.claude/.cache/visual-pending-<session_id>` (runtime state — gitignored, never
committed). The `Stop` hook uses the `stop_hook_active` flag to block at most
once per pending state, so a turn can't loop forever if the dev server is down.

### Modes

Set `VISUAL_VERIFY_MODE` (env var) to control strictness:

| Value | Behavior |
|---|---|
| `block` *(default)* | Reminder fires **and** the Stop hook blocks until Playwright MCP is used |
| `warn` | Reminder fires; finishing is never blocked |
| `off` | Hooks do nothing |

Per-developer override: add it to your gitignored `.claude/settings.local.json`, e.g.

```json
{ "env": { "VISUAL_VERIFY_MODE": "warn" } }
```

or export it in your shell for a one-off session (`$env:VISUAL_VERIFY_MODE="off"`
in PowerShell). The default lives in code, so doing nothing keeps full enforcement.

### Requirements

Hooks run via `node` (no `jq` dependency). They need Node on `PATH` and, for
actual verification, the dev server reachable at `http://localhost:3000`.
