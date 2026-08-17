---
id: 037
title: refuseRead/refuseWrite allow a `..` traversal path to match a glob (deals/../people/secret.md passes deals/**)
status: todo
kind: fix
size: s
wave: 1
depends_on: []
touches: [apps/web/lib/tools/perimeter.ts, apps/web/tests/tools-perimeter.test.ts]
created_by: 035
session: null
model: null
effort: null
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
