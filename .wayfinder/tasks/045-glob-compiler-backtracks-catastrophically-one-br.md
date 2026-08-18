---
id: 045
title: Glob compiler backtracks catastrophically — one bridge call or one previewed Tool freezes the whole Node process
status: done
kind: fix
size: s
wave: 2
depends_on: []
touches: [apps/web/lib/tools/perimeter.ts, apps/web/lib/tools/bridge.ts, apps/web/tests/tools-perimeter.test.ts, apps/web/tests/tools-bridge.test.ts]
created_by: 044
session: ed87c87b-4a00-472e-be1b-f5c38f13a8ba
model: sonnet
effort: high
---

## Task

`lib/tools/perimeter.ts#globRegExp` compiles each middle `**` segment to `(?:[^/]+/)*`. Consecutive groups of that shape are exponential-backtracking regexes. Measured against the real module with subject path `'a/'.repeat(24) + 'index.md'`: glob `'**/'.repeat(8) + 'zzz.md'` (30 chars) takes 697 ms; `'**/'.repeat(10)` takes 9.3 s; `refuseRead` with `'**/'.repeat(14) + 'zzz.md'` as the perimeter's single read glob takes 141 SECONDS. Node is single-threaded, so this blocks the event loop for the entire web process — every user, every request. The bridge's 120-calls-per-minute rate limit does not help, because a single call never returns.

Two reachable doors:

(1) `lib/tools/bridge.ts#contextList` validates the caller's glob only as `z.string().max(512)` (`P.list`) and then calls `globMatch(glob, meta.path)` for every entry of the visible vault, BEFORE the perimeter test. Nothing checks the glob against a grammar. Any member who can resolve any bridge target can post `{method:'context.list', params:{glob:'**/'.repeat(100)+'zzz.md'}}` and hang the server.

(2) `parseToolPerimeter`/`parseGlobList` accept `**/**/**/...` as a declared `perimeter.read` entry — it satisfies `GLOB_ENTRY_RE` (`/^[A-Za-z0-9._*\/-]+$/`) and has no `.`/`..` segment. `lib/tools/target.ts#resolvePreview` parses the LIVE index note, so a member need only write `tools/x/index.md` with such a read glob in their own space and open the preview: the first `context.read` hangs the process. No publish and no super-admin review is involved. A published version carries the same glob into every installing space.

Fix, in three parts:

- **Make the compiler linear.** In `globRegExp`, collapse consecutive `**` segments to one before building the source (`a/**/**/b` and `a/**/b` mean the same thing), and cap the remaining wildcard groups — a pattern with more than a small number (2-3) of `**` segments, or a segment with more than a few `*`s, should not compile to a backtracking regex. Collapsing alone is not sufficient: `**/a*/**/a*/**/x` still backtracks, so a hard cap on the count of variable-length groups per pattern is the load-bearing part.
- **Refuse pathological patterns at parse time** in `parseGlobList`, with the existing author-readable error style, so an author learns their glob is over the limit when they save the note rather than never. Add the same cap to the perimeter's own entries.
- **Validate the bridge's caller-supplied glob.** `contextList` must run the incoming `glob` through the same grammar/limit check (export a predicate from perimeter.ts rather than duplicating `GLOB_ENTRY_RE`) and return `err('invalid', ...)` for anything that fails, instead of handing an arbitrary string to the compiler. While there, bound `globCache` (a plain unbounded `Map` keyed by caller-supplied patterns) — a simple size cap with a clear on overflow is enough.

Tests: add a perimeter test that a many-`**` glob is refused at parse and that `globMatch`/`refuseRead` on a collapsed pattern return promptly (assert a wall-clock ceiling, e.g. under 100 ms, for the 14-group case that currently takes 141 s), plus a bridge test that `context.list` with a pathological glob comes back `invalid` without touching `visibleVault` (wire it as a throw-trap dep, the way the existing feature-key tests do).

## Outcome

Fixed the catastrophic-backtracking glob compiler and closed both doors that reached it (the caller-supplied `context.list` glob, and an author's own declared perimeter entries).

`lib/tools/perimeter.ts#globRegExp`: adjacent `**` segments are now collapsed to one before building the regex source (`collapseDoubleStars`) — this alone fixes the measured 697ms/9.3s/141s cases, since they were all consecutive `**`. That's not sufficient on its own (e.g. `**/a*/**/a*/**/x` has no adjacent pair to collapse and still backtracks), so a new exported pure predicate `isGlobPatternSafe` caps the pattern to at most 2 non-adjacent `**` groups and at most 3 `*`s within a single segment; globRegExp itself checks this as a backstop and compiles to a `NEVER_MATCH` regex (`/(?!)/`) rather than a backtracking one if a pattern somehow reaches it unvalidated. `globCache` is now bounded (`GLOB_CACHE_MAX = 1000`, cleared on overflow) so caller-supplied patterns can't grow it unboundedly.

`parseGlobList` now rejects a glob over the cap at parse time with an author-readable error ("too many wildcard segments..."), so both `perimeter.read`/`perimeter.write` in a Tool's index note and a declared read glob are covered — an author learns this when they save the note. A new exported `isValidGlobEntry` combines the `GLOB_ENTRY_RE` grammar check, traversal check, and `isGlobPatternSafe` into one predicate.

`lib/tools/bridge.ts#contextList` now runs the caller-supplied `glob` param through `isValidGlobEntry` before anything else, returning `err('invalid', ...)` for anything that fails — so `context.list` with a pathological glob (e.g. `**/`.repeat(100)) can no longer reach `globMatch`/the vault scan at all.

Verified: added tests to `tests/tools-perimeter.test.ts` (consecutive-`**` case matches correctly and completes in <100ms where it previously took 141s; a genuinely-multi-group pathological glob is refused/never-matches and stays fast; `refuseRead` on a many-`**` perimeter entry is prompt; `isValidGlobEntry` accepts normal globs and refuses pathological/traversal ones; `parseToolPerimeter` refuses the pathological cases with the new error) and `tests/tools-bridge.test.ts` (`context.list` with a pathological glob returns `invalid` without ever calling `visibleVault`, using the existing throw-trap `deps()` pattern). Ran `pnpm --filter @visvine/web exec node --import tsx --test tests/tools-perimeter.test.ts tests/tools-bridge.test.ts` (74/74 pass), full `pnpm --filter @visvine/web test` (892/892 pass), `tsc --noEmit` (clean), and `eslint` on the four touched files (clean, --max-warnings=0).
