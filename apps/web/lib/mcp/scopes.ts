/**
 * OAuth scope catalogue for the MCP server — three scopes, matching the three
 * things the tool surface does: read context, write context, and call external
 * systems through admin-configured connectors.
 *
 * Scopes are the COARSE capability gate carried by an access token, enforced
 * per-tool in `withCtx`. They do NOT replace the per-community authorization
 * check: every tool re-derives the caller's membership and brain grants live
 * (via `resolveBrain`/`principalOf`, the same path the web routes use), so a
 * token carrying `context:write` is still refused on a community where the
 * caller has no write access.
 */

export const MCP_SCOPES = ['context:read', 'context:write', 'connectors:use'] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/** Plain-language consent copy — what the user actually sees when approving. */
export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'context:read':
    'Read the context of communities you belong to — entities, notes and how they connect',
  'context:write':
    'Create entities and write notes in communities where you already have write access',
  'connectors:use':
    'Call external APIs and databases through connectors configured by community admins',
}

/**
 * The scope each tool requires. Declared here rather than inline at each call
 * site so the transport layer can answer "does this token allow this tool?"
 * *before* dispatch, and reply with a real RFC 6750 `insufficient_scope`
 * challenge the client can step up from (lib/mcp/challenge.ts). `withCtx` reads
 * the same map, so the two can never disagree.
 */
export const TOOL_SCOPES = {
  list_communities: 'context:read',
  list_context: 'context:read',
  search_context: 'context:read',
  get_entity: 'context:read',
  create_entity: 'context:write',
  write_note: 'context:write',
  append_note: 'context:write',
  // Listing rides context:read — search already surfaces connector note bodies
  // to read tokens, so discovery isn't the secret; execution is.
  list_connectors: 'context:read',
  run_connector: 'connectors:use',
} as const satisfies Record<string, McpScope>

export type McpToolName = keyof typeof TOOL_SCOPES

export function scopeForTool(name: string): McpScope | null {
  return (TOOL_SCOPES as Record<string, McpScope>)[name] ?? null
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
