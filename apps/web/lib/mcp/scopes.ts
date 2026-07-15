/**
 * OAuth scope catalogue for the MCP server.
 *
 * Scopes are the COARSE capability gate carried by an access token. They are
 * enforced per-tool in `withCtx`. They do NOT replace the fine-grained,
 * per-community role check — every community-scoped tool ALSO re-derives the
 * caller's membership/role live (via the existing API routes) before touching
 * data. A token may carry `crm:write` yet still be refused on a community where
 * the user is only a `member`. See docs/MCP.md.
 */

export const MCP_SCOPES = [
  "communities:read",
  "profile:read",
  "profile:write",
  "directory:read",
  "directory:write",
  "crm:read",
  "crm:write",
  "events:read",
  "events:write",
  "events:manage",
  "intros:read",
  "intros:write",
  "messages:read",
  "feed:read",
  "resources:read",
  "resources:write",
  "content:read",
  "content:write",
  "analytics:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

const SCOPE_SET: ReadonlySet<string> = new Set(MCP_SCOPES);

function isValidScope(scope: string): scope is McpScope {
  return SCOPE_SET.has(scope);
}

/** Read-only subset, granted by default when a client requests no scope. */
export const DEFAULT_SCOPES: McpScope[] = MCP_SCOPES.filter((s) =>
  s.endsWith(":read"),
);

/** Parse a space-delimited scope string, dropping unknown scopes. */
export function parseScopes(raw: string | null | undefined): McpScope[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .filter((s) => s.length > 0)
    .filter(isValidScope);
}

export function serializeScopes(scopes: readonly string[]): string {
  return scopes.join(" ");
}

/**
 * Reduce a requested scope string to the subset that (a) is valid and (b) the
 * client is allowed to request. If the client has no scope allowlist, any valid
 * scope is permitted. If the request is empty, fall back to DEFAULT_SCOPES.
 */
export function negotiateScopes(
  requested: string | null | undefined,
  clientAllowlist: string | null | undefined,
): McpScope[] {
  const req = parseScopes(requested);
  const allowed = clientAllowlist ? new Set(parseScopes(clientAllowlist)) : null;
  const base = req.length > 0 ? req : DEFAULT_SCOPES;
  if (!allowed) return base;
  return base.filter((s) => allowed.has(s));
}
