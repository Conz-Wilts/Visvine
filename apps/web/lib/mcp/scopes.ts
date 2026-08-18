/**
 * OAuth scope catalogue for the MCP server — one scope per kind of thing the
 * tool surface does: read context, write context, call external systems through
 * admin-configured connectors, run an agent, author a Tool, install a Tool.
 *
 * Scopes are the COARSE capability gate carried by an access token, enforced
 * per-tool in `withCtx`. They do NOT replace the per-space authorization
 * check: every tool re-derives the caller's membership and context grants live
 * (via `resolveContext`/`principalOf`, the same path the web routes use), so a
 * token carrying `context:write` is still refused on a space where the
 * caller has no write access.
 */

export const MCP_SCOPES = [
  'context:read',
  'context:write',
  'connectors:use',
  'agents:run',
  'tools:author',
  'tools:install',
] as const

export type McpScope = (typeof MCP_SCOPES)[number]

/** Plain-language consent copy — what the user actually sees when approving. */
export const SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  'context:read':
    'Read the context of spaces you belong to — entities, notes and how they connect',
  'context:write':
    'Create entities and write notes in spaces where you already have write access',
  'connectors:use':
    'Call external APIs and databases through connectors configured by space admins',
  'agents:run':
    'Trigger a run of an agent you authored or administer — it runs on the space\'s model key with the reach its brief declares',
  'tools:author':
    'Build tools in your spaces — write their code, compile it, and submit one for review to the tool marketplace',
  'tools:install':
    'Install a reviewed tool from the marketplace into a space you administer',
}

/**
 * The scope each tool requires. Declared here rather than inline at each call
 * site so the transport layer can answer "does this token allow this tool?"
 * *before* dispatch, and reply with a real RFC 6750 `insufficient_scope`
 * challenge the client can step up from (lib/mcp/challenge.ts). `withCtx` reads
 * the same map, so the two can never disagree.
 */
export const TOOL_SCOPES = {
  list_spaces: 'context:read',
  list_context: 'context:read',
  search_context: 'context:read',
  read_context: 'context:read',
  list_files: 'context:read',
  read_file: 'context:read',
  add_context: 'context:write',
  edit_context: 'context:write',
  append_context: 'context:write',
  move_context: 'context:write',
  // The clean pass analyzes read-only by default, but its apply/trash actions
  // mutate — one scope for the whole tool keeps step-up simple, and analysis
  // without write intent is what list_context/search_context are for anyway.
  clean_context: 'context:write',
  // Listing the vocabulary rides the same tool as editing it, and editing is
  // admin-only anyway — one scope keeps step-up simple.
  manage_alias: 'context:write',
  // Listing rides context:read — search already surfaces connector note bodies
  // to read tokens, so discovery isn't the secret; execution is.
  list_connectors: 'context:read',
  run_connector: 'connectors:use',
  // Same split as connectors: the roster is member-visible, execution is the
  // privilege. Authoring a brief is NOT an MCP tool — agents/ is frozen for
  // AI origins (agents are written by people).
  list_agents: 'context:read',
  run_agent: 'agents:run',
  // Tools (lib/mcp/appTools.ts). Three splits, each for a different reason:
  //  • Reading a Tool is reading notes — the roster, the source and the SDK
  //    docs carry nothing a `context:read` token couldn't already fetch with
  //    read_context, and get_tool_sdk is a static document.
  //  • Authoring writes EXECUTABLE code into a space, so it does not ride
  //    `context:write`: a token granted to summarise notes should not be able
  //    to add a running app to the sidebar. Publishing rides it too — it is
  //    the last step of authoring, and it is admin-gated underneath.
  //  • Installing puts someone ELSE'S code in front of a space's members. It
  //    is the only act here that runs code nobody in the space wrote, so it
  //    gets a scope of its own that a purely authoring agent never asks for.
  list_tools: 'context:read',
  read_tool: 'context:read',
  get_tool_sdk: 'context:read',
  create_tool: 'tools:author',
  write_tool: 'tools:author',
  check_tool: 'tools:author',
  preview_tool: 'tools:author',
  publish_tool: 'tools:author',
  install_tool: 'tools:install',
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
