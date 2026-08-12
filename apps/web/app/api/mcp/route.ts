/**
 * The Visvine MCP endpoint (Streamable HTTP).
 *
 * Every request must carry a Bearer access token minted by our own OAuth 2.1
 * server (app/api/oauth/*). An unauthenticated request gets a 401 whose
 * WWW-Authenticate header points at the protected-resource metadata and names
 * the scopes to ask for; a request whose token lacks the scope for the tool it
 * calls gets a 403 `insufficient_scope` the client can step up from.
 */
import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import { registerTools } from '@/lib/mcp/tools'
import { verifyMcpBearer } from '@/lib/mcp/auth'
import { withScopeGate, withScopeHint } from '@/lib/mcp/challenge'
import { mcpResourceUrl, mcpServerInfo } from '@/lib/mcp/config'

export const runtime = 'nodejs'
export const maxDuration = 60

const RESOURCE_METADATA_URL = `${mcpResourceUrl()}/.well-known/oauth-protected-resource`

const handler = createMcpHandler(
  (server) => {
    registerTools(server)
  },
  {
    serverInfo: mcpServerInfo(),
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
)

const authHandler = withScopeHint(
  withMcpAuth(withScopeGate(handler, RESOURCE_METADATA_URL), verifyMcpBearer, {
    required: true,
    resourceUrl: mcpResourceUrl(),
  }),
)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
