---
id: 051
title: MCP authoring/install tools skip the `tools` feature-key gate every other door enforces
status: done
kind: fix
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/mcp/appTools.ts, apps/web/tests/tools-mcp.test.ts]
created_by: 050
session: fe696703-434a-4d44-b7a1-2eb48da56cae
model: sonnet
effort: high
---

## Task

`apps/web/lib/mcp/appTools.ts` is the only Tools entry point that never checks the `tools` feature key. Every handler (createTool, listTools, readTool, writeTool, checkTool, getToolSdk, previewTool, publishTool, installTool) calls `deps.resolveTarget(ctx, space_id)` and goes straight to the service; `featureAccessForbidden` is never imported in that file.

Every sibling door does check it:
- `apps/web/lib/tools/route.ts#requireToolsAccess` gates all eight REST routes on `featureAccessForbidden(userId, spaceId, 'tools', email)`.
- `apps/web/lib/tools/target.ts#forbiddenForTools` (line ~233) gates every bridge call and frame token the same way.
- The direct precedent is in the same MCP layer: `apps/web/lib/mcp/tools.ts` lines 1307 and 1349 do exactly this for `'agents'` in `list_agents` / `run_agent`, throwing `new McpError(403, 'The Agents tool is not available to you in this space')`.

Effect: a space whose admin switched Tools off — where the navbar icon is hidden, `/tools` is bounced by the shell route guard, every REST route 403s, and the bridge refuses to run anything — can still be authored into over MCP and, more seriously, **installed into**: `install_tool` succeeds, writes an `app_tool_installs` row and places a `tool:<slug>` rail key, putting a running third-party app into a space that turned the feature off. (`installVersion` does check `isAdmin`, so this is not a privilege escalation — it is the feature switch being ignored.)

Fix: add one helper in `appTools.ts`, e.g. `async function requireToolsFeature(target: Target, deps)` called immediately after each `deps.resolveTarget(...)`, throwing `new McpError(403, 'The Tools feature is not available to you in this space')`. Route it through `AppToolDeps` like the other service calls so the existing throw-trap `deps` fixture in `tests/tools-mcp.test.ts` can stub it, and add a test asserting a handler refuses when the key is off (mirror the shape of the existing admin-refusal tests).

## Outcome

Fixed: apps/web/lib/mcp/appTools.ts now enforces the `tools` feature-key gate on every space-scoped handler, matching the REST route guard (requireToolsAccess) and the bridge guard (forbiddenForTools).

Added `featureAccessForbidden(userId, spaceId, email): Promise<boolean>` to the `AppToolDeps` seam (live impl calls `lib/auth.ts#featureAccessForbidden(..., 'tools', ...)`, mirroring the `'agents'` precedent in lib/mcp/tools.ts). Added a `requireToolsFeature(ctx, target, deps)` helper that throws `new McpError(403, 'The Tools feature is not available to you in this space')` and wired it in immediately after `deps.resolveTarget(...)` in create_tool, list_tools, write_tool, publish_tool, install_tool, and once inside the shared `requireTool` helper used by read_tool, check_tool, preview_tool. `get_tool_sdk` was left ungated since it takes no `space_id` argument at all (static SDK docs, not space-scoped) — it never called resolveTarget to begin with, so the earlier task description's list of "every handler" doesn't quite hold for it.

In tests/tools-mcp.test.ts: added a default `featureAccessForbidden: async () => false` stub to the shared `deps()` fixture (so all 23 existing tests keep passing unmodified), and added one new test that runs all 8 space-scoped handlers through a `deps({ featureAccessForbidden: async () => true })` fixture and asserts each throws a 403 with the shared refusal message — since every other deps method stays on the `unexpected()` throw-trap, this also proves the gate fires before any service call.

Verified: `node --import tsx --test tests/tools-mcp.test.ts` (24/24 pass), `tests/mcp-scopes.test.ts` (4/4 pass, no regression from the AppToolDeps interface change), `tsc --noEmit` clean, `eslint --max-warnings=0` clean on both changed files.
