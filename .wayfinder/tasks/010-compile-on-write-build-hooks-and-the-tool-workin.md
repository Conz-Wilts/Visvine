---
id: 010
title: Compile-on-write build hooks and the Tool working-copy service
status: todo
kind: build
size: m
wave: 2
depends_on: [003, 004, 005, 006]
touches: [apps/web/lib/tools/builds.ts, apps/web/lib/tools/hooks.ts, apps/web/lib/tools/service.ts, apps/web/lib/notes/store.ts, apps/web/tests/tools-builds.test.ts]
created_by: 002
session: null
model: null
effort: null
---

## Task

Wire compile-on-write for Tool notes, mirroring apps/web/lib/agents/hooks.ts (which the store calls after write/rename/delete — read how store.ts imports and calls `agentNoteWritten/Renamed/Deleted`).

**lib/tools/builds.ts**: `rebuildTool(spaceId, name): Promise<AppToolBuild>` — reads `tools/<name>/index.md`, `ui.md`, `data.md` via the store (shared context of the space; use `readNoteOrNull` with the shared owner key like agents do), `parseToolConfig` (+ `unwrapSource`), `compileToolUi` / `compileToolData`, then upserts `AppToolBuild` (ok only when config parses AND ui compiles; data is optional but if present must parse); `sourceHash` over the three sources; skip the compile when the hash is unchanged. `getBuild(spaceId, name)`, `deleteBuild(spaceId, name)`. Export a `BuildSummary` type `{ ok, errors, warnings, sizeBytes, config, configError, updatedAt }`.

**lib/tools/hooks.ts**: `toolNoteWritten(context, path)`, `toolNoteRenamed(context, from, to)`, `toolNoteDeleted(context, path)` — only act for shared context and `isToolPath`; written → `rebuildTool` for that tool (fire-and-await; failures logged, never thrown into the write path); renamed folder → delete old build + rebuild new; deleted index → delete build. Same dynamic-import discipline as agents/hooks.ts to avoid cycles.

**lib/notes/store.ts**: call the three hooks beside the agent hooks (write, rename, delete, and folder rename/delete paths). Minimal diff.

**lib/tools/service.ts** (server, principal-aware): `listAuthoredTools(p, context): Promise<AuthoredToolSummary[]>` (every `tools/<name>/index.md` visible to the principal + build summary + createdBy), `describeAuthoredTool(p, context, name)` (config, sources unwrapped as `{ 'ui.tsx': code, 'data.js': code, 'index.md': md }`, build), `createTool(p, context, { name, title, description })` (creates the entity folder index via the store's folder-index path — check `createIndexFolder`/`writeNote` in store.ts and the entity-folder docs — plus empty `ui.md` scaffold with a hello-world default export and `data.md` with `handlers` scaffold; refuse if exists or name invalid), `writeToolFile(p, context, name, file: 'index.md'|'ui.tsx'|'data.js', content)` → writes the mapped note (wrapping code) through `writeGated` under the principal (so grants and writeDenial apply), awaits the build, and returns `{ build: BuildSummary }` so callers see compile errors immediately; `writeErrorsToPlain(build)` helper formatting diagnostics as `ui.tsx:12:5 message`.

Tests (tests/tools-builds.test.ts): pure parts — hash skip logic and the diagnostics formatter; plus a DB-backed test is NOT expected (no DB in unit tests) — instead structure builds.ts so the read/compile/persist steps are injectable and test the orchestration with fakes. Acceptance: tsc/lint/test/knip clean; a manual smoke via `pnpm dev` + writing `tools/hello/ui.md` through the UI or the notes API produces an `app_tool_builds` row (state whether you did).
