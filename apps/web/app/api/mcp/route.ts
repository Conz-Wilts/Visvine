/**
 * The Visvine MCP endpoint (Streamable HTTP).
 *
 * One tool, `visvine`, and every action behind it: reading, searching and
 * writing context, calling connectors, running agents, and building and
 * installing Tools. Which of them a request needs is answered by the action
 * notes, not by which endpoint a client connected to.
 *
 * Assembly — bearer verification bound to this resource URL, and scope
 * challenges — lives in lib/mcp/handler.ts.
 */
import { buildMcpHandler } from '@/lib/mcp/handler'
import { registerTools } from '@/lib/mcp/register'

export const runtime = 'nodejs'
export const maxDuration = 60

const authHandler = buildMcpHandler(registerTools)

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
