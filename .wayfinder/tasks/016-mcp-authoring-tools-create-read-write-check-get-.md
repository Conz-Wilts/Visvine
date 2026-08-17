---
id: 016
title: "MCP authoring tools: create/read/write/check/get_sdk/preview/publish/install + scopes"
status: todo
kind: build
size: l
wave: 3
depends_on: [010, 012, 004, 003]
touches: [apps/web/lib/mcp/appTools.ts, apps/web/lib/mcp/tools.ts, apps/web/lib/mcp/scopes.ts, apps/web/tests/tools-mcp.test.ts, apps/web/tests/mcp-scopes.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Give external vibe-coding agents (Claude Code / Cursor) the authoring loop over Visvine's MCP server. Study apps/web/lib/mcp/tools.ts (`registerTool` pattern, `withCtx(extra, name, fn)`, `resolveTarget` for space/context selection, how connectors' `run_connector` and agents' `run_agent` are declared) and lib/mcp/scopes.ts (`TOOL_SCOPES` is the single source; tests may assert every registered tool has a scope).

Create **lib/mcp/appTools.ts** exporting `registerAppTools(server, deps?)` and — for scripts/tests — the plain handler functions (`appToolHandlers = { createTool, listTools, readTool, writeTool, checkTool, getToolSdk, previewTool, publishTool, installTool }`, each `(ctx: McpContext, args) => Promise<CallToolResult-ish JSON>`). Register from tools.ts with a one-line call beside the other groups. Add scopes `tools:author` (create_tool, write_tool, check_tool, preview_tool, publish_tool) and `tools:install` (install_tool); `list_tools`, `read_tool`, `get_tool_sdk` under `context:read`. Update scope negotiation/`ALL_SCOPES` and any consent-page scope descriptions (grep for existing scope labels).

Tools (zod schemas, crisp descriptions written FOR an LLM author — the description is the manual):
- `create_tool { space?, name, title, description }` → creates the entity folder + scaffolds via `createTool`; returns the file list, the deep link `visvine-desktop://open/tools/preview/<name>`, the web preview URL `${appOrigin}/tools/preview/<name>`, and a pointer to `get_tool_sdk`.
- `list_tools { space? }` → authored tools with build status + installed tools of the space.
- `read_tool { space?, name, file?: 'index.md'|'ui.tsx'|'data.js' }` → sources (unwrapped) + config + build diagnostics.
- `write_tool { space?, name, file: 'index.md'|'ui.tsx'|'data.js', content }` → `writeToolFile`; response ALWAYS includes the fresh build result: `ok` or the diagnostics formatted `ui.tsx:12:5 message` plus perimeter/config errors, so an agent can iterate.
- `check_tool { space?, name }` → rebuild + a lint report: config errors, compile diagnostics, perimeter summary (`describePerimeter`), requirements against this space (`computeRequirements`), surfaces summary, warnings (empty perimeter, page claim on built-in downgraded, missing description).
- `get_tool_sdk {}` → `TOOL_AUTHOR_GUIDE` + `TOOL_KIT_DTS` from lib/tools/sdkDocs.ts + the bridge method list.
- `preview_tool { space?, name }` → both URLs again + current build status (no rendering).
- `publish_tool { space?, name, note? }` → `publishTool` (admin-only; explain the review gate in the response).
- `install_tool { space?, versionId | key }` → `installVersion` (admin), returns install + conflicts + requirements.
All writes go through the same principal seams so `writeDenial`/grants apply; the response text should be short JSON-in-text like the existing tools. Tests: every new tool has a scope; handler unit tests with a fake `deps` (inject service functions) covering the write→diagnostics round trip and admin refusal on publish/install. Acceptance: tsc/lint/test/knip clean; run `pnpm dev` and call `list_tools` through the MCP endpoint if a token is easy to mint locally (report; optional).
