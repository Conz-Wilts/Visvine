---
id: 037
title: refuseRead/refuseWrite allow a `..` traversal path to match a glob (deals/../people/secret.md passes deals/**)
status: done
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/lib/tools/perimeter.ts, apps/web/tests/tools-perimeter.test.ts]
created_by: 035
session: 924fe137-50fc-4dfe-bf97-d862880f33fc
model: sonnet
effort: high
---

## Task

lib/tools/perimeter.ts validates the perimeter ENTRIES against traversal (parseGlobList rejects any entry with a `.` or `..` segment) but never validates the path being judged. `globRegExp('deals/**')` compiles to `^deals/.*$`, and `.*` happily spans `../`.

Reproduced against the current file:
  parseToolPerimeter({ read: ['deals/**'], write: ['deals/**'] })
  refuseRead(p, 'deals/../people/secret.md')   -> null  (ALLOWED)
  refuseRead(p, 'deals/../../etc/passwd')      -> null  (ALLOWED)
  refuseRead(p, 'deals/a/../../salaries.md')   -> null  (ALLOWED)
  refuseRead(p, '/deals/../secret.md')         -> null  (ALLOWED)
  refuseWrite behaves identically.
A backslash form (`deals\..\x.md`) is already refused, only because backslashes fail the segment match by accident.

This is the feature's central authorization gate and the module's own doc comment promises "no traversal". Whether it is exploitable today depends on the wave-2 bridge normalising every path before it calls the gate — the gate must not rely on that.

Fix in lib/tools/perimeter.ts: reject the subject path in `globMatch` (and therefore in refuseRead/refuseWrite) when, after `normalizePath`, any `/`-separated segment is `.` or `..`, when it contains a backslash, or when it is empty. Return the ordinary refusal string from refuseRead/refuseWrite rather than throwing — keep the module's never-throw-for-policy contract — and word it so the author can tell it apart from a plain out-of-perimeter miss (e.g. `tool perimeter denied: <path> is not a valid context path`). Update the grammar comment above globRegExp to state that the subject is validated too.

Add cases to apps/web/tests/tools-perimeter.test.ts covering each of the five paths above (all must refuse), plus the control that `deals/ok.md` and `deals/a/b/c.md` still pass and that a legitimate leading slash (`/deals/ok.md`) still normalises and passes.

## Outcome

Fixed the traversal hole: refuseRead/refuseWrite/globMatch now validate the subject path, not just the glob entries.

Added `isValidSubjectPath` in lib/tools/perimeter.ts: after `normalizePath` (leading-slash strip), rejects a path if it contains a backslash, is empty, or has any `.`/`..` segment. `globMatch` now calls it before testing the compiled regex, so no glob (however permissive, including bare `**`) can match a traversal subject. `refuseRead`/`refuseWrite` check it first and return a distinct, never-throwing refusal — `tool perimeter denied: <path> is not a valid context path` — so callers/reviewers can tell an invalid-path denial apart from an ordinary out-of-perimeter miss. Updated the `globRegExp` grammar doc comment to state the subject is validated too.

Added tests in apps/web/tests/tools-perimeter.test.ts covering all five reproduction paths (`deals/../people/secret.md`, `deals/../../etc/passwd`, `deals/a/../../salaries.md`, `/deals/../secret.md`, `deals\..\x.md`) against both `globMatch` (with `deals/**` and bare `**`) and `refuseRead`/`refuseWrite`, plus the control cases (`deals/ok.md`, `deals/a/b/c.md`, `/deals/ok.md` still pass).

Verified: `pnpm --filter @visvine/web exec node --import tsx --test tests/tools-perimeter.test.ts` — 23/23 pass. `pnpm --filter @visvine/web exec tsc --noEmit` clean. `eslint lib/tools/perimeter.ts tests/tools-perimeter.test.ts --max-warnings=0` clean. No other files currently call refuseRead/refuseWrite/globMatch (bridge wiring is wave 2), so this is fully isolated.
