# Board

The notes in one folder, newest first, with a quick add — a Visvine Tool.

## Build it

You need Node 20 or later.

```sh
npm install
npx visvine-tool dev          # run it offline, against fixtures/ — http://localhost:4800
npx visvine-tool check        # build and check it with Visvine's own rules
npx visvine-tool login        # sign in to Visvine (once)
npx visvine-tool push         # send it to a space as its working copy, and preview it there
npx visvine-tool publish      # publish a version into that space
```

`push` and `publish` ask which space when you are in more than one — pass
`--space <id>` (`npx visvine-tool spaces` lists them); the folder remembers it.
Against a Visvine running on your own machine, add `--server http://localhost:3000`.

## What is here

| | |
|---|---|
| `visvine-tool.json` | the manifest: what it is, what it may touch, what each space binds |
| `src/ui.tsx` | the interface — React, on the kit |
| `src/*.ts(x)` | more modules, imported as `./<name>` |
| `src/data.js` | handlers that run beside the space's data |
| `fixtures/` | the space `dev` runs it in: `space.json`, `notes/`, `resources/` |
| `AGENTS.md` | everything an AI coding agent needs to build it — read it first |
| `COMPONENTS.md` | the kit's components, the app's own look |

## With an AI coding agent

Open the folder in Claude Code, Cursor or Codex and describe the Tool you
want. `AGENTS.md` is the agent's manual: the manifest, the permissions, the
kit, the limits and the commands. `.mcp.json` connects it to Visvine, so it can
check and push the Tool itself.

## CI

`.github/workflows/check.yml` runs `visvine-tool check` on every pull
request. To push from CI too, make a deploy key on the tool's page in Visvine
and add it and the space as repository secrets `VISVINE_TOOL_KEY` and
`VISVINE_SPACE`. A publish made with a key waits for a space admin.
