/**
 * The Visvine CREATOR MCP endpoint (Streamable HTTP): the Tool authoring loop
 * only — list_spaces, get_tool_sdk, create/read/write/check/preview/publish
 * _tool. Its own OAuth protected resource, so a token for the context server
 * (../route.ts) is not accepted here and vice versa; a client connects to
 * this URL when someone is BUILDING a Tool, and to /api/mcp for everything
 * else. Assembly lives in lib/mcp/handler.ts.
 */
import { buildMcpHandler } from '@/lib/mcp/handler'
import { registerCreatorTools } from '@/lib/mcp/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

const authHandler = buildMcpHandler('creator', registerCreatorTools)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
