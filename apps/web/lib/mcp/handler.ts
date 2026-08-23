/**
 * One MCP endpoint, assembled the same way for both servers.
 *
 * Every request must carry a Bearer access token minted by our own OAuth 2.1
 * server (app/api/oauth/*) FOR THIS SERVER — the token's `aud` is the resource
 * URL of exactly one of them. An unauthenticated request gets a 401 whose
 * WWW-Authenticate header points at this server's protected-resource metadata
 * and names the scopes to ask for; a request whose token lacks the scope for
 * the tool it calls gets a 403 `insufficient_scope` the client can step up
 * from.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { McpServer } from '@modelcontextprotocol/server'
import { mcpBearerVerifier } from '@/lib/mcp/auth'
import { withScopeGate, withScopeHint } from '@/lib/mcp/challenge'
import { mcpInstructions, mcpResourceUrl, mcpServerInfo, type McpServerKind } from '@/lib/mcp/config'

export function buildMcpHandler(
  kind: McpServerKind,
  register: (server: McpServer) => void,
): (req: Request) => Response | Promise<Response> {
  const resourceUrl = mcpResourceUrl(kind)
  const resourceMetadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`

  const handler = createMcpHandler((server) => register(server), {
    serverInfo: mcpServerInfo(kind),
    // Read by the client at initialize, before it has called anything — the
    // only place to correct the note-first misreading this surface invites.
    instructions: mcpInstructions(kind),
    verboseLogs: process.env.NODE_ENV !== 'production',
  })

  return withScopeHint(
    withMcpAuth(withScopeGate(handler, resourceMetadataUrl), mcpBearerVerifier(kind), {
      required: true,
      resourceUrl,
    }),
    kind,
  )
}
