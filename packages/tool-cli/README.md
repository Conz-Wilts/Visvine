# visvine-tool

Build a [Visvine](https://visvine.com) Tool in your own editor, with your own
coding agent: run it offline against fixtures, check it with Visvine's own
rules, and push and publish it to a space.

```sh
npx @visvine/tool-cli init my-tool # or start from the tool-starter template
cd my-tool && npm install
npx visvine-tool dev              # offline, in the frame Visvine runs it in
npx visvine-tool check            # Visvine's compiler and checks, locally
npx visvine-tool login            # sign in (once)
npx visvine-tool push             # the working copy, in a space
npx visvine-tool publish          # a version, in that space
```

| Command | Does |
| --- | --- |
| `init <folder>` | A new Tool from the starter. |
| `dev` | Serves the Tool at http://localhost:4800 in its sandboxed frame, answered from `fixtures/` under the same permission gates as Visvine; the kit's components beside it; every call listed. `--port`. With `--space <id>` it pushes on every save instead and opens the space's own preview. |
| `check` | Builds and checks the Tool as a publish would. `--remote` asks the server too. |
| `pack` | Writes `<name>.vvtool`. `--out`. |
| `login` / `logout` | Signs in to a Visvine server with OAuth — the browser asks you to approve. `--no-browser` prints the link. |
| `whoami`, `spaces` | Who the CLI is, and the spaces it can push to. |
| `push` | Sends the Tool to a space as its working copy and prints where to preview it. `--space <id>`; the folder remembers it. |
| `publish` | Pushes, then publishes a version with CHANGELOG.md's newest notes. `--note` for the approver. |

The dev page is plain HTTP, for an agent with no browser: `GET /__state` (the
build and what the frame is told), `POST /__bridge` with
`{"method", "params"}` (one bridge call, answered from fixtures) and
`POST /__viewer` with `{"id"}` or `{"isAdmin"}` (look as someone else) — the
POSTs with the header `X-Visvine-Dev: 1`.

Every command takes `--server <url>` (or `VISVINE_SERVER`; the default is the
server last signed in to, else https://visvine.com) and `--dir <folder>`.

## CI

A deploy key — made on the Tool's page in Visvine — lets a pipeline push that
one Tool: set `VISVINE_TOOL_KEY` and `VISVINE_SPACE`. It can push, check and
publish that Tool and nothing else, and a version published with it waits for
a space admin.
