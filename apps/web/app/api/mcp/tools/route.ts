/**
 * The Visvine Tools MCP endpoint (Streamable HTTP): the `visvine` router and a
 * named tool per action, over building, checking, previewing, publishing and
 * installing Tools — and the few reads an author needs to find the space and
 * its data. Everything else is the main server at `/api/mcp`.
 *
 * Same assembly as the main endpoint (lib/mcp/handler.ts); only the surface
 * differs — its resource URL, metadata, instructions and catalogue.
 */
import { buildMcpHandler } from '@/lib/mcp/handler'
import { registerToolTools } from '@/lib/mcp/register'

export const runtime = 'nodejs'
export const maxDuration = 60

const authHandler = buildMcpHandler(registerToolTools, 'tools')

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
