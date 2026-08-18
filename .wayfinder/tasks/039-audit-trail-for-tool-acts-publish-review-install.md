---
id: 039
title: Audit trail for Tool acts (publish/review/install/upgrade/bridge)
status: done
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/notes/shared/contextTypes.ts, apps/web/lib/tools/registry.ts, apps/web/lib/tools/installs.ts, apps/web/lib/tools/bridge.ts]
created_by: 012
session: d5741655-5a1e-4161-b80d-306fcc2e28fc
model: sonnet
effort: high
---

## Task

`AuditEntry.action` in apps/web/lib/notes/shared/contextTypes.ts enumerates the audited act kinds ('connector', 'agent', 'secret', …) and has no member for Tools, so nothing in lib/tools writes to the audit sidecar. Connector runs and agent activations are audited; the Tool acts that deserve the same trail are publish, withdraw, review (approve/reject), install, uninstall, enable/disable, type-claim change and upgrade in lib/tools/registry.ts + lib/tools/installs.ts, plus the bridge's gated writes in lib/tools/bridge.ts. Add one `| 'tool'` member to the action union and call `logAudit(spaceId, { userId, name, action: 'tool', path, detail })` at those points (path = the tool's index note path or `tools/<slug>` for an install; detail = 'published v3', 'approved v3 by …', 'installed <key> as <slug>', 'upgraded to v4', etc.). Two agents in wave 2 (012 registry, 011 bridge) both wanted this and neither took it, to avoid racing on the shared union. Keep the entry wording consistent with the connector/agent lines so the console's activity view reads uniformly.

## Outcome

Added a 'tool' member to AuditEntry.action and wired logAudit calls at every Tool act named in the task.

contextTypes.ts: added `| 'tool'` with a comment listing the act kinds it covers. registry.ts: publishTool logs 'published vN' at the index path; withdrawVersion (previously had no route wired to it) now selects the version's name/version/sourceSpaceId/author name and logs 'withdrew vN'; reviewVersion selects sourceSpaceId/name and logs '<approved|rejected> vN by <reviewer email>' plus the note. installs.ts: installVersion, uninstall, setInstallEnabled, setTypeClaims and applyUpgrade each log against `tools/<slug>` with details 'installed <key> as <slug>', 'uninstalled <key> (<slug>)', 'enabled/disabled <slug>', 'type claims changed on <slug>: type=mode, …', and 'upgraded to vN' respectively (refreshRequirements was left alone — it isn't one of the audited acts). bridge.ts: the two gated-write audit calls in contextWrite/contextAppend switched from action 'write' to action 'tool' (these are the bridge's own gated writes the task called out).

Where an actor only carries {userId, email} (no display name in scope), I used the email as the audit `name` field rather than expanding those signatures into route/MCP files outside my lease — matches the existing "display name/email" convention documented on FolderMember. Also fixed a pre-existing bug found by typecheck: applyUpgrade's `next` version lookup was missing `version: true` in its Prisma select, so `next.version` didn't compile.

Verified: `tsc --noEmit` clean, `eslint` clean on all four touched files, and `node --import tsx --test tests/tools-registry.test.ts tests/tools-bridge.test.ts tests/tools-perimeter.test.ts tests/tools-mcp.test.ts tests/mcp.test.ts` — 150 tests, 0 failures.
