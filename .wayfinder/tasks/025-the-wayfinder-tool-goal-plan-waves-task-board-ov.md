---
id: 025
title: "The Wayfinder Tool: goal/plan/waves/task board over notes with agent dispatch (source + seed)"
status: todo
kind: build
size: l
wave: 5
depends_on: [016, 015, 017, 022, 018]
touches: [examples/tools/wayfinder/**, apps/web/scripts/seed-wayfinder-tool.ts, docs/wayfinder-tool.md]
created_by: 002
session: null
model: null
effort: null
---

## Task

The acceptance test: rebuild the Wayfinder harness's planning board as a Visvine Tool, authored ONLY through the public Tool mechanism (MCP handlers + `@visvine/tool-kit`), no privileged code paths. Study `.wayfinder/tasks/*.md` (frontmatter: id, title, status, kind, size, wave, depends_on[], touches[]; body `## Task` / `## Outcome`) and `.wayfinder/tasks/plan.md` (Goal / Brief / Context / Plan) — read-only, never modify .wayfinder.

**examples/tools/wayfinder/index.md** — `type: tool`, title 'Wayfinder', description, `surfaces: { rail: { label: Wayfinder, icon: kanban }, types: [{ type: wayfinder-project, mode: page }, { type: wayfinder-task, mode: page }] }`, `perimeter: { read: ['harness/**', 'agents/*.md'], write: ['harness/**', 'agents/*.md'], types: [wayfinder-project, wayfinder-task], agents: ['wayfinder-*'] }`, docs body explaining the note layout.

**Note layout** the Tool owns: `harness/<project>/index.md` (`type: wayfinder-project`, frontmatter `goal`, `status`, `waves: [{ n, title }]`, body = Goal / Brief / Plan sections) and `harness/<project>/tasks/<id>-<slug>.md` (`type: wayfinder-task`, frontmatter id, title, status: todo|doing|done|failed, size, wave, depends_on[], touches[], agent?: name, run?: { id, status, at }; body `## Task` / `## Outcome`).

**ui.tsx** (React + tool-kit only): rail page = project list (create project: name + goal → writes index.md), project view = plan panel (goal/brief editable, waves list) + task board (columns per wave, cards with status chip/size/deps, add task, edit inline, move across waves = frontmatter rewrite, mark done), a 'Run' button on a task that (via data.js) ensures an agent brief `agents/wayfinder-<project>-<id>.md` exists (member-writable brief; body = the task's `## Task` text + instructions to append `## Outcome` to the task note; `connectors: []`, `tools: []`) and calls `visvine.agents.run(name)`, then polls the task note for the outcome; type pages: for `wayfinder-project` notes render the project view with that note as subject; for `wayfinder-task` notes render the task detail. Show a degraded banner when the `agents` requirement is unmet, and clear error cards on failure.

**data.js** handlers: `loadProject`, `saveTask`, `moveTask`, `runTask` (write brief + agents.run + record `run` in task frontmatter) — all through `visvine.context.*` / `visvine.agents.run` so the perimeter is exercised. Keep frontmatter parsing in a tiny in-Tool helper (no yaml lib inside the isolate — write a minimal parser for the flat fields you use, or store task meta as JSON in a fenced block; state your choice in docs).

**scripts/seed-wayfinder-tool.ts**: creates the Tool through `appToolHandlers` (createTool + writeTool ×3), asserts the build is ok, publishes, approves as super-admin, installs into the target space (arg or local-dev default), ensures the custom types `wayfinder-project`/`wayfinder-task` exist in the space's nodeTypes (use the same merge helper the type backfill script uses), and seeds a `harness/visvine-tools/` project mirroring THIS plan (goal, waves, a handful of tasks) so the board opens populated. Idempotent. **docs/wayfinder-tool.md**: what it proves, layout, how to run the seed, known limits (an agent run edits notes, not code). Acceptance: seed passes locally; `pnpm dev` shows the Wayfinder rail item, the board renders and a task can be moved and Run creates a brief + a run row (an agent run needs a model key — if none is configured locally, assert the brief + the run attempt/refusal path and say so); tsc/lint/knip clean (examples/ must be excluded from knip/tsc — check tsconfig `include` and knip.json; add an ignore if needed).
