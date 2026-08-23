/**
 * The OAuth discovery documents, defined once.
 *
 * There is one authorization-server document and one protected-resource
 * document PER MCP SERVER (context / creator). Each resource document is served
 * from two paths (the origin root, RFC 9728 path-suffixed, and the MCP
 * endpoint's own sub-path), because MCP clients probe both; they must be
 * byte-identical, which is easiest to guarantee by building them here.
 */
import { oauthIssuer, mcpResourceUrl, type McpServerKind } from '@/lib/mcp/config'
import { MCP_SCOPES, scopesForKind } from '@/lib/mcp/scopes'

/** These documents are public and fetched cross-origin by browser-based agents. */
export const METADATA_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
} as const

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
export function authorizationServerMetadata(): Record<string, unknown> {
  const issuer = oauthIssuer()
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    // Retained for clients that predate Client ID Metadata Documents; MCP
    // 2026-07-28 deprecates dynamic registration in favour of the flag below.
    registration_endpoint: `${issuer}/api/oauth/register`,
    scopes_supported: [...MCP_SCOPES],
    response_types_supported: ['code'],
    // Authorization code only. There are no refresh tokens to grant, and
    // nothing to revoke — an access token is a stateless 30-day JWT, so this
    // server advertises no revocation endpoint either.
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    // A client may use its own HTTPS metadata-document URL as its client_id and
    // skip registration entirely.
    client_id_metadata_document_supported: true,
    // We return `iss` on every authorization response, so a client can complete
    // the RFC 9207 mix-up check.
    authorization_response_iss_parameter_supported: true,
  }
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) for one MCP server. */
export function protectedResourceMetadata(kind: McpServerKind): Record<string, unknown> {
  return {
    resource: mcpResourceUrl(kind),
    authorization_servers: [oauthIssuer()],
    scopes_supported: [...scopesForKind(kind)],
    bearer_methods_supported: ['header'],
    resource_name: kind === 'creator' ? 'Visvine Creator' : 'Visvine context',
  }
}
