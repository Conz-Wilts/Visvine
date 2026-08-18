/**
 * The Visvine MCP endpoint (Streamable HTTP) — the CONTEXT server: read,
 * search and write context, call connectors, run agents, discover and install
 * Tools. Building a Tool is the creator server's job (./creator/route.ts).
 * Assembly (bearer verification bound to this server's resource URL, scope
 * challenges) lives in lib/mcp/handler.ts.
 */
import { buildMcpHandler } from '@/lib/mcp/handler'
import { registerTools } from '@/lib/mcp/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

const authHandler = buildMcpHandler('context', registerTools)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
