---
id: 039
title: Audit trail for Tool acts (publish/review/install/upgrade/bridge)
status: todo
kind: build
size: s
wave: 3
depends_on: []
touches: [apps/web/lib/notes/shared/contextTypes.ts, apps/web/lib/tools/registry.ts, apps/web/lib/tools/installs.ts, apps/web/lib/tools/bridge.ts]
created_by: 012
session: null
model: null
effort: null
---

## Task

`AuditEntry.action` in apps/web/lib/notes/shared/contextTypes.ts enumerates the audited act kinds ('connector', 'agent', 'secret', …) and has no member for Tools, so nothing in lib/tools writes to the audit sidecar. Connector runs and agent activations are audited; the Tool acts that deserve the same trail are publish, withdraw, review (approve/reject), install, uninstall, enable/disable, type-claim change and upgrade in lib/tools/registry.ts + lib/tools/installs.ts, plus the bridge's gated writes in lib/tools/bridge.ts. Add one `| 'tool'` member to the action union and call `logAudit(spaceId, { userId, name, action: 'tool', path, detail })` at those points (path = the tool's index note path or `tools/<slug>` for an install; detail = 'published v3', 'approved v3 by …', 'installed <key> as <slug>', 'upgraded to v4', etc.). Two agents in wave 2 (012 registry, 011 bridge) both wanted this and neither took it, to avoid racing on the shared union. Keep the entry wording consistent with the connector/agent lines so the console's activity view reads uniformly.
