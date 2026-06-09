/**
 * URL configuration for the MCP server + its self-hosted OAuth 2.1 layer.
 *
 * In local dev these all resolve to http://localhost:3000. In production set
 * NEXT_PUBLIC_APP_URL (public origin) and optionally MCP_INTERNAL_BASE_URL
 * (origin the server uses to call its own API routes — usually the same).
 */

export function appBaseUrl(): string {
  const raw =
    process.env.MCP_INTERNAL_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/** Public origin == OAuth 2.0 Authorization Server issuer (RFC 8414). */
export function oauthIssuer(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || appBaseUrl()).replace(/\/$/, "");
}

/**
 * The RFC 8707 resource identifier for the MCP server. The access token `aud`
 * must equal this, and the protected-resource metadata advertises it.
 */
export function mcpResourceUrl(): string {
  return (process.env.MCP_RESOURCE_URL || `${oauthIssuer()}/api/mcp`).replace(/\/$/, "");
}
