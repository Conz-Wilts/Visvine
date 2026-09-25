/**
 * OAuth scope catalogue for the MCP servers — one scope per kind of thing the
 * action surface does: read context, write context, call external systems
 * through admin-configured connectors, run an agent, author a Tool, install a
 * Tool, store a credential.
 *
 * Scopes are the COARSE capability gate carried by an access token, enforced
 * per ACTION in `runAction`. They are also the ONLY boundary between reading
 * someone's notes and writing executable code into their space, now that both
 * live behind one tool on one server — which is why every one of them has
 * consent copy, and why the default grant is read-only. They do NOT replace the per-space authorization
 * check: every action re-derives the caller's membership and context grants
 * live (via `resolveContext`/`principalOf`, the same path the web routes use),
 * so a token carrying `context:write` is still refused on a space where the
 * caller has no write access.
 *
 * The action → scope map is not here. It lives on each action's definition
 * (lib/actions/defs/*) and is read through `scopeForAction`, so a new action
 * cannot be added without declaring one, and no note or caller can influence
 * which scope applies.
 */

export const MCP_SCOPES = [
  'context:read',
  'context:write',
  'messages:write',
  'connectors:use',
  'agents:run',
  'agents:author',
  'agents:admin',
  'tools:author',
  'tools:install',
  'secrets:write',
  'vm:run',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/** Plain-language consent copy — what the user actually sees when approving. */
export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'context:read':
    'Read the context of spaces you belong to — entities, notes and how they connect',
  'context:write':
    'Create entities and write notes in spaces where you already have write access',
  'messages:write':
    'Post in channels you are in, as you — sharing a file or a link into one',
  'connectors:use':
    'Call external APIs and databases through connectors configured by space admins',
  'agents:run':
    'Trigger a run of an agent you can edit — it runs on the space\'s model key with the reach its brief declares',
  'agents:author':
    'Write agent briefs in your spaces — the instructions an agent follows and the connectors it may reach. A new brief does nothing until it is turned on',
  'agents:admin':
    'Turn agents you can edit on and off — an agent you turn on runs unattended on the space\'s model key, on the schedule you set',
  'tools:author':
    'Build tools in your spaces — write their code, compile it, and publish it into the space for its admins to approve',
  'tools:install':
    'Install an approved tool into a space you administer, and manage the tools it runs',
  'secrets:write':
    'Store and rotate connector credentials in spaces you administer — values are write-only and can never be read back, by this client or any other',
  'vm:run':
    "Run commands on an agent's machine — a real computer in the space, reaching only the hosts its egress policy allows",
}

const SCOPE_SET: ReadonlySet<string> = new Set(MCP_SCOPES)

function isValidScope(scope: string): scope is McpScope {
  return SCOPE_SET.has(scope)
}

/** Granted when a client requests no scope at all: read-only. */
export const DEFAULT_SCOPES: McpScope[] = ['context:read']

/** Parse a space-delimited scope string, dropping unknown scopes. */
export function parseScopes(raw: string | null | undefined): McpScope[] {
  if (!raw) return []
  return raw
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .filter(isValidScope)
}

export function serializeScopes(scopes: readonly string[]): string {
  return scopes.join(' ')
}

/**
 * Reduce a requested scope string to the subset that (a) is valid and (b) the
 * client registered for. No allowlist on the client means any valid scope may
 * be requested; an empty request falls back to DEFAULT_SCOPES.
 *
 * There is no per-server ceiling above this: one server offers every action, so
 * what a connection may do is decided by what it ASKS for and what the person
 * approves. A client that never requests `tools:author` can never author — the
 * same protection a separate endpoint gave, expressed where the consent screen
 * can actually show it (SCOPE_DESCRIPTIONS).
 */
export function negotiateScopes(
  requested: string | null | undefined,
  clientAllowlist: string | null | undefined,
): McpScope[] {
  const req = parseScopes(requested)
  const allowed = clientAllowlist ? new Set(parseScopes(clientAllowlist)) : null
  const base = req.length > 0 ? req : DEFAULT_SCOPES
  if (!allowed) return base
  return base.filter((s) => allowed.has(s))
}
